"""FastAPI app: public + operator endpoints (contract in ../PLAN.md)."""
from __future__ import annotations

import hashlib
import io
import json
import logging
import secrets
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import (BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Query,
                     UploadFile)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from . import assessor, config, samples, views
from .db import GROUP_LOCK, get_conn, init_db, new_id, now_iso, tx
from .processing import process_report, recover_interrupted, route_in_tx

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("api")

STATUSES = ("processing", "in_review", "published", "critical", "rejected", "failed")
INCIDENT_STATES = ("provisional", "active", "merged")
PIL_TYPES = {"JPEG": ("image/jpeg", "jpg"), "PNG": ("image/png", "png"), "WEBP": ("image/webp", "webp")}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.ASSESSOR_MODE == "openai" and not config.OPENAI_API_KEY:
        raise RuntimeError("ASSESSOR=openai requires OPENAI_API_KEY (or use ASSESSOR=auto/replay/mock)")
    init_db()
    n = recover_interrupted()
    if n:
        log.warning("Marked %d interrupted report(s) as failed", n)
    mode = config.ASSESSOR_MODE
    log.info("Assessor: %s", {"openai": f"OpenAI {config.OPENAI_MODEL}",
                              "replay": "REPLAY of recorded samples (keyword mock otherwise)",
                              "mock": "MOCK (keyword-based)"}[mode])
    yield


app = FastAPI(title="Incident Reporter API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def _bad(msg: str, code: int = 422):
    raise HTTPException(status_code=code, detail=msg)


@app.get("/api/health")
def health():
    recorded = [f for s in samples.load() if (f := samples.fixture(s)) is not None]
    if config.ASSESSOR_MODE == "openai":
        model = config.OPENAI_MODEL
    elif config.ASSESSOR_MODE == "replay":
        model = ", ".join(sorted({str(f.get("model")) for f in recorded})) or None
    else:
        model = None
    return {"ok": True, "assessor": assessor.model_name(), "mode": config.ASSESSOR_MODE, "model": model,
            "recorded_samples": len(recorded)}


@app.get("/api/samples")
def list_samples():
    return [{
        "id": s["id"], "title": s.get("title") or s["id"], "description": s.get("description"),
        "photo_url": f"/api/samples/{s['id']}/photo" if samples.photo_path(s) else None,
        "latitude": s.get("latitude"), "longitude": s.get("longitude"), "credit": s.get("credit"),
        "recorded": samples.fixture(s) is not None,
    } for s in samples.load()]


@app.get("/api/samples/{sample_id}/photo")
def sample_photo(sample_id: str):
    s = samples.get(sample_id)  # looked up by id; the path never comes from the request
    path = samples.photo_path(s) if s else None
    if path is None:
        raise HTTPException(404, "sample photo not found")
    return FileResponse(path, media_type=samples.MEDIA_TYPES[path.suffix.lower()])


# ================================================================ public
@app.post("/api/reports", status_code=202)
def submit_report(
    background: BackgroundTasks,
    submission_key: str = Form(...),
    receipt_token: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    incident_time: str = Form(...),
    description: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    conn: sqlite3.Connection = Depends(get_conn),
):
    # ---- validation
    try:
        submission_key = str(uuid.UUID(submission_key.strip()))
    except ValueError:
        _bad("submission_key must be a UUID")
    if len(receipt_token) < config.MIN_RECEIPT_TOKEN_CHARS or len(receipt_token) > 512:
        _bad(f"receipt_token must be {config.MIN_RECEIPT_TOKEN_CHARS}-512 characters")
    if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        _bad("latitude/longitude out of range")
    try:
        it = datetime.fromisoformat(incident_time.strip().replace("Z", "+00:00"))
    except ValueError:
        _bad("incident_time must be ISO-8601")
    if it.tzinfo is None:
        it = it.replace(tzinfo=timezone.utc)
    it = it.astimezone(timezone.utc)
    if it > datetime.now(timezone.utc) + timedelta(minutes=10):
        _bad("incident_time cannot be in the future")
    incident_time_iso = it.isoformat(timespec="seconds")
    description = (description or "").strip() or None
    if description and len(description) > config.MAX_DESCRIPTION_CHARS:
        _bad(f"description longer than {config.MAX_DESCRIPTION_CHARS} characters")

    photo_bytes, media_type, ext = None, None, None
    if photo is not None and (photo.filename or photo.size):
        photo_bytes = photo.file.read(config.MAX_PHOTO_BYTES + 1)
        if len(photo_bytes) == 0:
            photo_bytes = None
        elif len(photo_bytes) > config.MAX_PHOTO_BYTES:
            _bad("photo larger than 10 MB", 413)
        else:
            try:
                img = Image.open(io.BytesIO(photo_bytes))
                fmt = img.format
                img.verify()
            except (UnidentifiedImageError, Exception):
                _bad("photo is not a valid image")
            if fmt not in PIL_TYPES:
                _bad("photo must be JPEG, PNG or WebP")
            media_type, ext = PIL_TYPES[fmt]

    lat, lon = round(latitude, 6), round(longitude, 6)
    receipt_hash = sha256(receipt_token.encode())
    canonical = json.dumps({
        "submission_key": submission_key, "description": description,
        "latitude": f"{lat:.6f}", "longitude": f"{lon:.6f}", "incident_time": incident_time_iso,
        "photo_sha256": hashlib.sha256(photo_bytes).hexdigest() if photo_bytes else None,
        "receipt_token_sha256": receipt_hash.hex(),
    }, sort_keys=True, separators=(",", ":"))
    submission_hash = sha256(canonical.encode())

    def existing():
        row = conn.execute("SELECT id, status, submission_hash FROM report WHERE submission_key = ?",
                           (submission_key,)).fetchone()
        if row is None:
            return None
        if bytes(row["submission_hash"]) != submission_hash:
            raise HTTPException(409, "submission_key already used with a different payload")
        return JSONResponse({"id": row["id"], "status": row["status"]}, status_code=200)

    if (resp := existing()) is not None:
        return resp

    # ---- persist
    report_id, incident_id = new_id(), new_id()
    photo_name = None
    if photo_bytes:
        photo_name = f"{report_id}.{ext}"
        (config.UPLOAD_DIR / photo_name).write_bytes(photo_bytes)
    now = now_iso()
    has_evidence = bool(photo_bytes or description)
    status = "processing" if has_evidence else "in_review"
    try:
        with tx(conn):
            conn.execute(
                "INSERT INTO incident (id, state, category, latitude, longitude, incident_time, created_at) "
                "VALUES (?, 'provisional', NULL, ?, ?, ?, ?)",
                (incident_id, lat, lon, incident_time_iso, now),
            )
            conn.execute(
                "INSERT INTO report (id, submission_key, submission_hash, receipt_token_hash, incident_id, status, "
                "description, photo_path, photo_media_type, photo_size_bytes, latitude, longitude, incident_time, "
                "submitted_at, updated_at, processing_started_at, review_reason) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (report_id, submission_key, submission_hash, receipt_hash, incident_id, status, description,
                 photo_name, media_type, len(photo_bytes) if photo_bytes else None, lat, lon, incident_time_iso,
                 now, now, now if has_evidence else None, None if has_evidence else "no_evidence"),
            )
    except sqlite3.IntegrityError:
        if photo_name:
            (config.UPLOAD_DIR / photo_name).unlink(missing_ok=True)
        if (resp := existing()) is not None:  # lost a race on the same submission_key
            return resp
        raise
    if has_evidence:
        background.add_task(process_report, report_id)
    return {"id": report_id, "status": status}


def _report_with_receipt(conn, report_id: str, token: Optional[str]):
    row = views.get_report_row(conn, report_id)
    if row is None:
        raise HTTPException(404, "report not found")
    if not token or not secrets.compare_digest(bytes(row["receipt_token_hash"]), sha256(token.encode())):
        raise HTTPException(403, "invalid receipt token")
    return row


@app.get("/api/reports/{report_id}")
def get_report_public(report_id: str, x_receipt_token: Optional[str] = Header(None),
                      conn: sqlite3.Connection = Depends(get_conn)):
    row = _report_with_receipt(conn, report_id, x_receipt_token)
    return views.report_public(conn, row, public=True)


def _photo_response(row):
    if not row["photo_path"]:
        raise HTTPException(404, "report has no photo")
    path = config.UPLOAD_DIR / row["photo_path"]
    if not path.exists():
        raise HTTPException(404, "photo file missing")
    return FileResponse(path, media_type=row["photo_media_type"])


@app.get("/api/reports/{report_id}/photo")
def get_report_photo_public(report_id: str, token: Optional[str] = Query(None),
                            conn: sqlite3.Connection = Depends(get_conn)):
    return _photo_response(_report_with_receipt(conn, report_id, token))


def _published_by_incident(conn) -> dict[str, list]:
    out: dict[str, list] = {}
    for row in conn.execute(views.REPORT_SELECT + " WHERE r.status = 'published' ORDER BY r.incident_time"):
        out.setdefault(row["incident_id"], []).append(row)
    return out


def _marker(inc, pub_rows) -> dict:
    return {
        "id": inc["id"], "category": inc["category"], "latitude": inc["latitude"], "longitude": inc["longitude"],
        "incident_time": inc["incident_time"], "published_count": len(pub_rows),
        "max_severity": views.max_level((views.final_of(r) or {}).get("severity") for r in pub_rows),
    }


@app.get("/api/incidents")
def list_incidents_public(conn: sqlite3.Connection = Depends(get_conn)):
    pub = _published_by_incident(conn)
    rows = conn.execute("SELECT * FROM incident WHERE state = 'active' ORDER BY incident_time DESC").fetchall()
    return [_marker(i, pub[i["id"]]) for i in rows if i["id"] in pub]


@app.get("/api/incidents/{incident_id}")
def get_incident_public(incident_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    inc = conn.execute("SELECT * FROM incident WHERE id = ? AND state = 'active'", (incident_id,)).fetchone()
    pub = conn.execute(views.REPORT_SELECT + " WHERE r.status = 'published' AND r.incident_id = ? "
                       "ORDER BY r.incident_time", (incident_id,)).fetchall()
    if inc is None or not pub:
        raise HTTPException(404, "incident not found")
    d = _marker(inc, pub)
    d["reports"] = [{
        "id": r["id"], "description": r["description"], "incident_time": r["incident_time"],
        "severity": (views.final_of(r) or {}).get("severity"), "urgency": (views.final_of(r) or {}).get("urgency"),
    } for r in pub]
    return d


# ================================================================ operator
def require_operator(authorization: Optional[str] = Header(None), token: Optional[str] = Query(None)):
    supplied = None
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    elif token:
        supplied = token
    if not supplied or not secrets.compare_digest(supplied.encode(), config.OPERATOR_TOKEN.encode()):
        raise HTTPException(401, "operator token required", headers={"WWW-Authenticate": "Bearer"})


op = [Depends(require_operator)]


@app.get("/api/operator/summary", dependencies=op)
def operator_summary(conn: sqlite3.Connection = Depends(get_conn)):
    counts = {s: 0 for s in STATUSES}
    for row in conn.execute("SELECT status, COUNT(*) c FROM report GROUP BY status"):
        counts[row["status"]] = row["c"]
    counts["active_incidents"] = conn.execute("SELECT COUNT(*) FROM incident WHERE state='active'").fetchone()[0]
    return counts


@app.get("/api/operator/reports", dependencies=op)
def operator_reports(status: Optional[str] = None, conn: sqlite3.Connection = Depends(get_conn)):
    if status and status not in STATUSES:
        _bad(f"status must be one of {', '.join(STATUSES)}")
    q = views.REPORT_SELECT + (" WHERE r.status = ?" if status else "") + " ORDER BY r.submitted_at DESC"
    return [views.report_summary(r) for r in conn.execute(q, (status,) if status else ())]


def _op_report(conn, report_id: str):
    row = views.get_report_row(conn, report_id)
    if row is None:
        raise HTTPException(404, "report not found")
    return row


@app.get("/api/operator/reports/{report_id}", dependencies=op)
def operator_report(report_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    return views.report_detail(conn, _op_report(conn, report_id))


@app.get("/api/operator/reports/{report_id}/photo", dependencies=op)
def operator_report_photo(report_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    return _photo_response(_op_report(conn, report_id))


INCIDENT_OP_SELECT = """
SELECT i.*,
  (SELECT COUNT(*) FROM report r WHERE r.incident_id = i.id) AS report_count,
  (SELECT COUNT(*) FROM report r WHERE r.incident_id = i.id AND r.status = 'published') AS published_count,
  (SELECT COUNT(*) FROM report r WHERE r.incident_id = i.id AND r.status = 'critical') AS critical_count
FROM incident i
"""


def _incident_op(row) -> dict:
    return {k: row[k] for k in ("id", "state", "category", "latitude", "longitude", "incident_time", "created_at",
                                "merged_into_id", "report_count", "published_count", "critical_count")}


@app.get("/api/operator/incidents", dependencies=op)
def operator_incidents(state: Optional[str] = None, conn: sqlite3.Connection = Depends(get_conn)):
    if state and state not in INCIDENT_STATES:
        _bad(f"state must be one of {', '.join(INCIDENT_STATES)}")
    q = INCIDENT_OP_SELECT + (" WHERE i.state = ?" if state else "") + " ORDER BY i.created_at DESC"
    return [_incident_op(r) for r in conn.execute(q, (state,) if state else ())]


@app.get("/api/operator/incidents/{incident_id}", dependencies=op)
def operator_incident(incident_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    row = conn.execute(INCIDENT_OP_SELECT + " WHERE i.id = ?", (incident_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "incident not found")
    d = _incident_op(row)
    d["reports"] = [views.report_detail(conn, r) for r in conn.execute(
        views.REPORT_SELECT + " WHERE r.incident_id = ? ORDER BY r.submitted_at DESC", (incident_id,))]
    return d


Category = Literal["fire_smoke", "road_hazard", "infrastructure_damage", "waste_pollution", "other"]
Level = Literal["low", "medium", "high"]


class ReviewIn(BaseModel):
    action: Literal["approve", "reject"]
    final_category: Optional[Category] = None
    final_severity: Optional[Level] = None
    final_urgency: Optional[Level] = None
    operator_label: str = Field(min_length=1, max_length=200)
    comment: Optional[str] = Field(None, max_length=4000)


REVIEWABLE = ("in_review", "critical", "failed")


@app.post("/api/operator/reports/{report_id}/review", dependencies=op)
def operator_review(report_id: str, body: ReviewIn, conn: sqlite3.Connection = Depends(get_conn)):
    if not body.operator_label.strip():
        _bad("operator_label is required")
    if body.action == "approve" and not (body.final_category and body.final_severity and body.final_urgency):
        _bad("approve requires final_category, final_severity and final_urgency")
    fc, fs, fu = (body.final_category, body.final_severity, body.final_urgency) if body.action == "approve" \
        else (None, None, None)
    with GROUP_LOCK, tx(conn):
        r = conn.execute("SELECT * FROM report WHERE id = ?", (report_id,)).fetchone()
        if r is None:
            raise HTTPException(404, "report not found")
        if r["status"] not in REVIEWABLE:
            raise HTTPException(409, f"report in status '{r['status']}' cannot be reviewed")
        rid, now = new_id(), now_iso()
        conn.execute(
            "INSERT INTO review_decision (id, report_id, assessment_id, action, final_category, final_severity, "
            "final_urgency, operator_label, comment, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (rid, report_id, r["current_assessment_id"], body.action, fc, fs, fu,
             body.operator_label.strip(), (body.comment or "").strip() or None, now),
        )
        conn.execute("UPDATE report SET current_review_id=?, updated_at=? WHERE id=?", (rid, now, report_id))
        if body.action == "reject":
            conn.execute("UPDATE report SET status='rejected' WHERE id=?", (report_id,))
        else:
            route_in_tx(conn, report_id, fc, fs, fu)
    return views.report_detail(conn, _op_report(conn, report_id))


@app.post("/api/operator/reports/{report_id}/retry", dependencies=op)
def operator_retry(report_id: str, background: BackgroundTasks, conn: sqlite3.Connection = Depends(get_conn)):
    schedule = False
    with tx(conn):
        r = conn.execute("SELECT status FROM report WHERE id = ?", (report_id,)).fetchone()
        if r is None:
            raise HTTPException(404, "report not found")
        if r["status"] == "failed":
            now = now_iso()
            conn.execute("UPDATE report SET status='processing', processing_started_at=?, updated_at=? WHERE id=?",
                         (now, now, report_id))
            schedule = True
        elif r["status"] == "in_review":
            raise HTTPException(409, "report is waiting for operator review; use review instead of retry")
        # published / critical / rejected / processing: no-op, return existing result (ERD §8.7)
    if schedule:
        background.add_task(process_report, report_id)
    return views.report_detail(conn, _op_report(conn, report_id))
