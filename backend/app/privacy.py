"""Personal-data handling: photo metadata stripping, report deletion (reporter request or retention) and the purge job."""
from __future__ import annotations

import io
import logging
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageOps

from . import config
from .db import GROUP_LOCK, connect, tx

log = logging.getLogger("privacy")

# Image.info keys that describe the encoding only. Anything else (exif, xmp, comment, photoshop/IPTC, PNG text
# chunks, ...) may identify the device, the person or the place, so the photo is re-encoded without it.
_STRUCTURAL_INFO = {
    "jfif", "jfif_version", "jfif_unit", "jfif_density", "dpi", "progression", "progressive", "adobe",
    "adobe_transform", "icc_profile", "gamma", "srgb", "chromaticity", "transparency", "aspect", "interlace",
    "loop", "duration", "background", "lossless",
}
_STRUCTURAL_APP = {"APP0", "APP2", "APP14"}  # JFIF, ICC profile, Adobe colour transform
_SAVE = {"JPEG": {"quality": 90}, "PNG": {}, "WEBP": {"quality": 90}}


def has_metadata(img: Image.Image) -> bool:
    if len(img.getexif()):
        return True
    if any(k not in _STRUCTURAL_INFO for k in img.info):
        return True
    return any(marker not in _STRUCTURAL_APP for marker, _ in getattr(img, "applist", []))


def strip_metadata(photo_bytes: bytes) -> bytes:
    """Photo without EXIF (GPS, device, timestamps), XMP, IPTC or comments. Images that carry none are returned
    byte-for-byte, so bundled samples keep matching their replay fixtures and clean photos are not re-compressed."""
    img = Image.open(io.BytesIO(photo_bytes))
    if not has_metadata(img):
        return photo_bytes
    fmt, icc = img.format, img.info.get("icc_profile")
    img = ImageOps.exif_transpose(img)  # bake in the orientation that the EXIF tag carried
    if fmt == "JPEG" and img.mode not in ("RGB", "L", "CMYK"):
        img = img.convert("RGB")
    img.info.clear()  # Pillow writes some info keys (comment, xmp) back out on save
    out = io.BytesIO()
    img.save(out, fmt, **_SAVE[fmt], **({"icc_profile": icc} if icc else {}))
    return out.getvalue()


# ---------------------------------------------------------------- deletion
def delete_report_in_tx(conn, report_id: str) -> str | None:
    """Deletes a report with its assessments, reviews and simulation, plus incident rows left without reports.
    Must run inside BEGIN IMMEDIATE while holding GROUP_LOCK. Returns the photo file name for the caller to unlink
    after commit."""
    r = conn.execute("SELECT incident_id, photo_path, latitude, longitude, incident_time FROM report WHERE id = ?",
                     (report_id,)).fetchone()
    if r is None:
        return None
    conn.execute("UPDATE report SET current_assessment_id = NULL, current_review_id = NULL WHERE id = ?",
                 (report_id,))
    conn.execute("DELETE FROM notification_simulation WHERE report_id = ?", (report_id,))
    conn.execute("DELETE FROM review_decision WHERE report_id = ?", (report_id,))
    conn.execute("DELETE FROM assessment WHERE report_id = ?", (report_id,))
    conn.execute("DELETE FROM report WHERE id = ?", (report_id,))

    # A report grouped into an existing incident leaves its own provisional incident behind as a 'merged' stub
    # with the report's coordinates and time. Remove that stub too.
    conn.execute(
        "DELETE FROM incident WHERE rowid = (SELECT rowid FROM incident WHERE state = 'merged' AND merged_into_id = ? "
        "AND latitude = ? AND longitude = ? AND incident_time = ? "
        "AND NOT EXISTS (SELECT 1 FROM report WHERE incident_id = incident.id) "
        "AND NOT EXISTS (SELECT 1 FROM incident m WHERE m.merged_into_id = incident.id) LIMIT 1)",
        (r["incident_id"], r["latitude"], r["longitude"], r["incident_time"]),
    )
    # The incident itself goes once its last report is gone, with the stubs merged into it. Leaves first: databases
    # from before routing re-pointed merges can hold chains (stub -> merged -> incident).
    if conn.execute("SELECT 1 FROM report WHERE incident_id = ?", (r["incident_id"],)).fetchone() is None:
        tree = [row[0] for row in conn.execute(
            "WITH RECURSIVE t(id) AS (SELECT ? UNION SELECT i.id FROM incident i JOIN t ON i.merged_into_id = t.id) "
            "SELECT id FROM t", (r["incident_id"],))]
        for iid in reversed(tree):  # breadth-first order reversed: children before their parent
            if conn.execute("SELECT 1 FROM report WHERE incident_id = ? UNION ALL "
                            "SELECT 1 FROM incident WHERE merged_into_id = ?", (iid, iid)).fetchone() is None:
                conn.execute("DELETE FROM notification_simulation WHERE incident_id = ?", (iid,))
                conn.execute("DELETE FROM incident WHERE id = ?", (iid,))
    return r["photo_path"]


def unlink_photo(photo_name: str | None) -> None:
    if photo_name:
        (config.UPLOAD_DIR / photo_name).unlink(missing_ok=True)


# ---------------------------------------------------------------- retention
def purge_expired(now: datetime | None = None) -> int:
    """Deletes reports whose last change is older than the retention period. Reports in processing are skipped."""
    now = now or datetime.now(timezone.utc)
    rules = [("status = 'rejected'", config.REJECTED_RETENTION_DAYS),
             ("status NOT IN ('rejected', 'processing')", config.RETENTION_DAYS)]
    conn = connect()
    n = 0
    try:
        for where, days in rules:
            if days <= 0:
                continue
            cutoff = (now - timedelta(days=days)).isoformat(timespec="microseconds")
            ids = [row["id"] for row in conn.execute(f"SELECT id FROM report WHERE {where} AND updated_at < ?",
                                                      (cutoff,))]
            for rid in ids:
                try:
                    with GROUP_LOCK, tx(conn):
                        # re-check inside the transaction: the report may have changed since the SELECT
                        still = conn.execute(f"SELECT 1 FROM report WHERE id = ? AND {where} AND updated_at < ?",
                                             (rid, cutoff)).fetchone()
                        photo = delete_report_in_tx(conn, rid) if still else None
                except Exception:  # rolled back; one bad row must not block the rest on every run
                    log.exception("Retention: failed to delete report %s", rid)
                    continue
                if still:
                    unlink_photo(photo)
                    n += 1
    finally:
        conn.close()
    if n:
        log.info("Retention: deleted %d expired report(s)", n)
    return n
