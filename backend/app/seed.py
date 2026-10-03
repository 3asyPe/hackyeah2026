"""Demo data around Kraków. Run: .venv/bin/python -m app.seed  (idempotent)."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageDraw

from . import config
from .db import connect, init_db, new_id, now_iso, tx
from .processing import recipient_count_for

SEED_NS = uuid.UUID("6f1c1b8e-1d7a-4c35-9a59-0b7f5e1a0c01")
CONF = {
    "low": (80.0, 15.0, 5.0),
    "medium": (15.0, 70.0, 15.0),
    "high": (5.0, 20.0, 75.0),
}
COLORS = {
    "fire_smoke": (200, 70, 30), "road_hazard": (90, 90, 90), "infrastructure_damage": (120, 100, 60),
    "waste_pollution": (60, 130, 60), "other": (70, 90, 160),
}

# (key, description, lat, lon, minutes_ago, category, severity, urgency, final status, extra)
SEEDS = [
    ("pub-1", "Overflowing trash bins and garbage bags on the pavement near the market square.",
     50.0617, 19.9373, 35, "waste_pollution", "low", "low", "published", {}),
    ("pub-2", "Large pothole on the tram crossing, cars swerving around it.",
     50.0540, 19.9500, 80, "road_hazard", "medium", "medium", "published", {}),
    ("pub-3", "Car accident at the intersection, debris on the road, one lane blocked.",
     50.0705, 19.9452, 20, "road_hazard", "high", "medium", "published", {"simulate": True}),
    ("pub-4", "Broken street light pole leaning over the sidewalk.",
     50.0480, 19.9280, 140, "infrastructure_damage", "medium", "low", "published", {}),
    ("pub-5", "Illegal dumping of construction waste by the Vistula boulevards.",
     50.0520, 19.9360, 200, "waste_pollution", "medium", "low", "published", {}),
    ("pub-6", "Damaged bench and graffiti in the park, glass on the playground.",
     50.0790, 19.9620, 60, "other", "low", "low", "published", {}),
    ("crit-1", "Smoke pouring out of an apartment building window, people on the balcony.",
     50.0650, 19.9200, 10, "fire_smoke", "high", "high", "critical", {}),
    ("rev-1", "mismatch: description says flooded underpass but photo shows a dry street.",
     50.0580, 19.9550, 25, "infrastructure_damage", "medium", "medium", "in_review",
     {"match": "mismatches", "reason": "photo_description_mismatch"}),
    ("rev-2", None, 50.0450, 19.9650, 15, None, None, None, "in_review", {"no_evidence": True}),
    ("fail-1", "Fallen tree branch blocking the bike lane.",
     50.0750, 19.9300, 30, None, None, None, "failed", {}),
]


def _h(s: str) -> bytes:
    return hashlib.sha256(s.encode()).digest()


def _photo(name: str, category: str | None, label: str) -> tuple[str, int]:
    img = Image.new("RGB", (640, 480), COLORS.get(category or "other", (100, 100, 100)))
    d = ImageDraw.Draw(img)
    d.rectangle((20, 20, 620, 460), outline=(255, 255, 255), width=4)
    d.text((40, 40), f"SEED DEMO PHOTO\n{label}", fill=(255, 255, 255))
    path = config.UPLOAD_DIR / name
    img.save(path, "JPEG", quality=80)
    return name, path.stat().st_size


def seed() -> None:
    init_db()
    conn = connect()
    try:
        first_key = str(uuid.uuid5(SEED_NS, SEEDS[0][0]))
        if conn.execute("SELECT 1 FROM report WHERE submission_key = ?", (first_key,)).fetchone():
            print("Seed data already present - skipping.")
            return
        now = datetime.now(timezone.utc)
        with tx(conn):
            for key, desc, lat, lon, mins, cat, sev, urg, status, extra in SEEDS:
                rid, iid = new_id(), new_id()
                ts = now_iso()
                itime = (now - timedelta(minutes=mins)).isoformat(timespec="seconds")
                active = status in ("published", "critical")
                conn.execute(
                    "INSERT INTO incident (id, state, category, latitude, longitude, incident_time, created_at) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (iid, "active" if active else "provisional", cat if active else None, lat, lon, itime, ts),
                )
                photo_name, size = (None, None)
                if not extra.get("no_evidence"):
                    photo_name, size = _photo(f"{rid}.jpg", cat, key)
                conn.execute(
                    "INSERT INTO report (id, submission_key, submission_hash, receipt_token_hash, incident_id, status, "
                    "description, photo_path, photo_media_type, photo_size_bytes, latitude, longitude, incident_time, "
                    "submitted_at, updated_at, processing_started_at, review_reason) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (rid, str(uuid.uuid5(SEED_NS, key)), _h("seed-hash-" + key), _h("seed-token-" + key), iid,
                     status, desc, photo_name, "image/jpeg" if photo_name else None, size, lat, lon, itime, ts, ts,
                     None if extra.get("no_evidence") else ts,
                     "no_evidence" if extra.get("no_evidence") else extra.get("reason")),
                )
                if extra.get("no_evidence"):
                    continue
                aid = new_id()
                if status == "failed":
                    conn.execute(
                        "INSERT INTO assessment (id, report_id, attempt_no, outcome, error_code, error_message, model, "
                        "prompt_version, started_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (aid, rid, 1, "failed", "timeout", "Seed: simulated OpenAI timeout after 30s", "seed",
                         config.PROMPT_VERSION, ts, ts),
                    )
                else:
                    sc, uc = CONF[sev], CONF[urg]
                    conn.execute(
                        "INSERT INTO assessment (id, report_id, attempt_no, outcome, category, severity, urgency, "
                        "severity_low_confidence, severity_medium_confidence, severity_high_confidence, "
                        "urgency_low_confidence, urgency_medium_confidence, urgency_high_confidence, "
                        "photo_description_match, scene_plausibility, time_consistency, manipulation_concerns, "
                        "explanation, model, prompt_version, started_at, completed_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (aid, rid, 1, "succeeded", cat, sev, urg, *sc, *uc, extra.get("match", "matches"),
                         "no_obvious_concerns", "no_obvious_concerns", "no_obvious_concerns",
                         f"[SEED] Demo assessment: {cat}, severity {sev}, urgency {urg}.", "seed",
                         config.PROMPT_VERSION, ts, ts),
                    )
                conn.execute("UPDATE report SET current_assessment_id = ? WHERE id = ?", (aid, rid))
                if extra.get("simulate"):
                    conn.execute(
                        "INSERT INTO notification_simulation (report_id, incident_id, radius_m, recipient_count, "
                        "simulated_at) VALUES (?,?,?,?,?)",
                        (rid, iid, config.SIM_RADIUS_M, recipient_count_for(rid), ts),
                    )
        print(f"Seeded {len(SEEDS)} reports. Receipt tokens are 'seed-token-<key>' (e.g. seed-token-pub-1).")
    finally:
        conn.close()


if __name__ == "__main__":
    seed()
