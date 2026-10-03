"""Processing pipeline (ERD §3, §8): assessment -> review check -> routing -> grouping -> critical/published -> simulation."""
from __future__ import annotations

import hashlib
import logging
import math
import sqlite3
from datetime import datetime
from typing import Optional

from . import assessor, config
from .db import GROUP_LOCK, connect, new_id, now_iso, tx

log = logging.getLogger("processing")

LEVELS = ("low", "medium", "high")


# ---------------------------------------------------------------- helpers
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def minutes_between(a: str, b: str) -> float:
    return abs((datetime.fromisoformat(a) - datetime.fromisoformat(b)).total_seconds()) / 60.0


def recipient_count_for(report_id: str) -> int:
    h = int(hashlib.sha256(report_id.encode()).hexdigest()[:8], 16)
    return config.SIM_MIN_RECIPIENTS + h % (config.SIM_MAX_RECIPIENTS - config.SIM_MIN_RECIPIENTS + 1)


def _has_conf_tie(row, prefix: str) -> bool:
    vals = [row[f"{prefix}_{lvl}_confidence"] for lvl in LEVELS]
    if any(v is None for v in vals):
        return False
    m = max(vals)
    return sum(1 for v in vals if v == m) > 1


def _low_top_conf(row, prefix: str) -> bool:
    vals = [row[f"{prefix}_{lvl}_confidence"] for lvl in LEVELS]
    return all(v is not None for v in vals) and max(vals) < config.MIN_TOP_CONFIDENCE


def review_reasons(a: sqlite3.Row) -> list[str]:
    """ERD §8.5: mismatch, undetermined classification, confidence tie, suspicious photo, low confidence => in_review."""
    reasons = []
    if a["photo_description_match"] == "mismatches":
        reasons.append("photo_description_mismatch")
    if a["category"] is None:
        reasons.append("category_undetermined")
    if a["severity"] is None:
        reasons.append("severity_undetermined")
    elif a["severity_low_confidence"] is None:
        reasons.append("severity_confidence_missing")
    if a["urgency"] is None:
        reasons.append("urgency_undetermined")
    elif a["urgency_low_confidence"] is None:
        reasons.append("urgency_confidence_missing")
    if _has_conf_tie(a, "severity"):
        reasons.append("severity_confidence_tie")
    if _has_conf_tie(a, "urgency"):
        reasons.append("urgency_confidence_tie")
    if a["scene_plausibility"] == "suspicious" or a["manipulation_concerns"] == "suspicious":
        reasons.append("suspicious_photo")
    if _low_top_conf(a, "severity") or _low_top_conf(a, "urgency"):
        reasons.append("low_confidence")
    return reasons


# ---------------------------------------------------------------- assessment
def _insert_assessment(conn, report_id: str, attempt_no: int, started_at: str, model: str,
                       out: Optional[assessor.AssessmentOutput], err: Optional[assessor.AssessmentError]) -> str:
    aid = new_id()
    base = dict(id=aid, report_id=report_id, attempt_no=attempt_no, model=model,
                prompt_version=config.PROMPT_VERSION, started_at=started_at, completed_at=now_iso())
    if out is not None:
        sc, uc = out.severity_confidence, out.urgency_confidence
        base.update(
            outcome="succeeded", category=out.category, severity=out.severity, urgency=out.urgency,
            severity_low_confidence=sc.low if sc else None,
            severity_medium_confidence=sc.medium if sc else None,
            severity_high_confidence=sc.high if sc else None,
            urgency_low_confidence=uc.low if uc else None,
            urgency_medium_confidence=uc.medium if uc else None,
            urgency_high_confidence=uc.high if uc else None,
            photo_description_match=out.photo_description_match,
            scene_plausibility=out.scene_plausibility, time_consistency=out.time_consistency,
            manipulation_concerns=out.manipulation_concerns, explanation=out.explanation,
        )
    else:
        base.update(outcome="failed", error_code=err.code, error_message=err.message[:1000])
    cols = ", ".join(base)
    conn.execute(f"INSERT INTO assessment ({cols}) VALUES ({', '.join('?' * len(base))})", list(base.values()))
    return aid


def process_report(report_id: str) -> None:
    """Background task. Runs the LLM call outside any transaction, then routes."""
    conn = connect()
    try:
        r = conn.execute("SELECT * FROM report WHERE id = ?", (report_id,)).fetchone()
        if r is None or r["status"] != "processing":
            return
        attempt_no = conn.execute(
            "SELECT COALESCE(MAX(attempt_no), 0) + 1 FROM assessment WHERE report_id = ?", (report_id,)
        ).fetchone()[0]
        started = now_iso()
        out, err, model = None, None, assessor.model_name()
        try:
            out, model = assessor.assess(assessor.AssessInput(
                report_id=report_id, attempt_no=attempt_no, description=r["description"],
                photo_path=str(config.UPLOAD_DIR / r["photo_path"]) if r["photo_path"] else None,
                photo_media_type=r["photo_media_type"], latitude=r["latitude"], longitude=r["longitude"],
                incident_time=r["incident_time"],
            ))
        except assessor.AssessmentError as e:
            err = e
        except Exception as e:  # never leave a report stuck in processing
            log.exception("assessment crashed")
            err = assessor.AssessmentError("internal_error", f"{type(e).__name__}: {e}")

        with GROUP_LOCK, tx(conn):
            cur = conn.execute("SELECT status FROM report WHERE id = ?", (report_id,)).fetchone()
            if cur["status"] != "processing":
                return
            try:
                aid = _insert_assessment(conn, report_id, attempt_no, started, model, out, err)
            except sqlite3.IntegrityError as e:  # model output violated DB constraints
                out, err = None, assessor.AssessmentError("invalid_response", f"constraint violation: {e}")
                aid = _insert_assessment(conn, report_id, attempt_no, started, model, None, err)
            now = now_iso()
            if out is None:
                conn.execute("UPDATE report SET current_assessment_id=?, status='failed', updated_at=? WHERE id=?",
                             (aid, now, report_id))
                return
            conn.execute("UPDATE report SET current_assessment_id=?, updated_at=? WHERE id=?", (aid, now, report_id))
            a = conn.execute("SELECT * FROM assessment WHERE id = ?", (aid,)).fetchone()
            reasons = review_reasons(a)
            if reasons:
                conn.execute("UPDATE report SET status='in_review', review_reason=?, updated_at=? WHERE id=?",
                             (", ".join(reasons), now, report_id))
                return
            route_in_tx(conn, report_id, a["category"], a["severity"], a["urgency"])
    except Exception:
        log.exception("process_report failed for %s", report_id)
    finally:
        conn.close()


# ---------------------------------------------------------------- routing
def route_in_tx(conn, report_id: str, category: str, severity: str, urgency: str) -> None:
    """Must be called inside BEGIN IMMEDIATE while holding GROUP_LOCK. Uses the final classification."""
    r = conn.execute("SELECT * FROM report WHERE id = ?", (report_id,)).fetchone()
    inc = conn.execute("SELECT * FROM incident WHERE id = ?", (r["incident_id"],)).fetchone()
    now = now_iso()
    incident_id = inc["id"]

    if inc["state"] != "provisional" and inc["category"] != category:
        # Operator re-review changed the category of an already grouped (critical) report -> regroup it.
        shared = conn.execute("SELECT 1 FROM report WHERE incident_id = ? AND id <> ? LIMIT 1",
                              (inc["id"], report_id)).fetchone()
        if shared is None:  # alone: reopen its own incident for grouping
            conn.execute("UPDATE incident SET state='provisional', category=? WHERE id=?", (category, inc["id"]))
        else:  # others stay; detach this report into a fresh provisional incident
            incident_id = new_id()
            conn.execute(
                "INSERT INTO incident (id, state, category, latitude, longitude, incident_time, created_at) "
                "VALUES (?, 'provisional', ?, ?, ?, ?, ?)",
                (incident_id, category, r["latitude"], r["longitude"], r["incident_time"], now),
            )
            conn.execute("UPDATE report SET incident_id=? WHERE id=?", (incident_id, report_id))
        inc = conn.execute("SELECT * FROM incident WHERE id = ?", (incident_id,)).fetchone()

    if inc["state"] == "provisional":
        best = None
        cands = conn.execute(
            "SELECT id, latitude, longitude, incident_time FROM incident "
            "WHERE state = 'active' AND category = ? AND id <> ?",
            (category, inc["id"]),
        ).fetchall()
        for c in cands:
            dist = haversine_m(inc["latitude"], inc["longitude"], c["latitude"], c["longitude"])
            dmin = minutes_between(inc["incident_time"], c["incident_time"])
            if dist > config.GROUP_MAX_DISTANCE_M or dmin > config.GROUP_MAX_TIME_MIN:
                continue
            score = dist * config.GROUP_DISTANCE_WEIGHT + dmin * config.GROUP_TIME_WEIGHT
            key = (score, c["id"])
            if best is None or key < best:
                best = key
        if best is not None:
            target = best[1]
            conn.execute("UPDATE incident SET state='merged', merged_into_id=?, category=? WHERE id=?",
                         (target, category, inc["id"]))
            conn.execute("UPDATE report SET incident_id=? WHERE id=?", (target, report_id))
            incident_id = target
        else:
            conn.execute("UPDATE incident SET state='active', category=? WHERE id=?", (category, inc["id"]))
    # else: already grouped earlier with the same category (e.g. operator re-reviews a critical report) -> keep it.

    status = "critical" if (severity == "high" and urgency == "high") else "published"
    conn.execute("UPDATE report SET status=?, updated_at=? WHERE id=?", (status, now, report_id))
    if status == "published" and severity == "high":
        conn.execute(
            "INSERT OR IGNORE INTO notification_simulation (report_id, incident_id, radius_m, recipient_count, simulated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (report_id, incident_id, config.SIM_RADIUS_M, recipient_count_for(report_id), now),
        )


def recover_interrupted() -> int:
    """On startup: reports stuck in processing -> failed with an 'interrupted' attempt."""
    conn = connect()
    n = 0
    try:
        with tx(conn):
            rows = conn.execute("SELECT id FROM report WHERE status = 'processing'").fetchall()
            for row in rows:
                rid = row["id"]
                attempt_no = conn.execute(
                    "SELECT COALESCE(MAX(attempt_no), 0) + 1 FROM assessment WHERE report_id = ?", (rid,)
                ).fetchone()[0]
                now = now_iso()
                aid = new_id()
                conn.execute(
                    "INSERT INTO assessment (id, report_id, attempt_no, outcome, error_code, error_message, model, "
                    "prompt_version, started_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (aid, rid, attempt_no, "failed", "interrupted", "Processing was interrupted by a server restart",
                     assessor.model_name(), config.PROMPT_VERSION, now, now),
                )
                conn.execute("UPDATE report SET status='failed', current_assessment_id=?, updated_at=? WHERE id=?",
                             (aid, now, rid))
                n += 1
    finally:
        conn.close()
    return n
