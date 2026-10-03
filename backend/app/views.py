"""Row -> JSON shapes from the API contract (PLAN.md)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from . import config

REPORT_SELECT = """
SELECT r.*, i.state AS incident_state,
       rd.action AS rv_action, rd.final_category AS rv_category,
       rd.final_severity AS rv_severity, rd.final_urgency AS rv_urgency,
       a.outcome AS a_outcome, a.category AS a_category, a.severity AS a_severity, a.urgency AS a_urgency
FROM report r
JOIN incident i ON i.id = r.incident_id
LEFT JOIN review_decision rd ON rd.id = r.current_review_id
LEFT JOIN assessment a ON a.id = r.current_assessment_id
"""

LEVEL_ORDER = {"low": 1, "medium": 2, "high": 3}


def final_of(row) -> Optional[dict]:
    """Final classification (ERD §8.4): operator approve > current successful model assessment.
    Only meaningful once routed (published / critical)."""
    if row["status"] not in ("published", "critical"):
        return None
    if row["rv_action"] == "approve":
        return {"category": row["rv_category"], "severity": row["rv_severity"],
                "urgency": row["rv_urgency"], "source": "operator"}
    if row["a_outcome"] == "succeeded":
        return {"category": row["a_category"], "severity": row["a_severity"],
                "urgency": row["a_urgency"], "source": "model"}
    return None


def _conf(a, prefix: str) -> Optional[dict]:
    if a[f"{prefix}_low_confidence"] is None:
        return None
    return {lvl: a[f"{prefix}_{lvl}_confidence"] for lvl in ("low", "medium", "high")}


def assessment_json(a) -> dict:
    return {
        "id": a["id"], "attempt_no": a["attempt_no"], "outcome": a["outcome"],
        "category": a["category"], "severity": a["severity"], "urgency": a["urgency"],
        "severity_confidence": _conf(a, "severity"), "urgency_confidence": _conf(a, "urgency"),
        "photo_description_match": a["photo_description_match"],
        "scene_plausibility": a["scene_plausibility"], "time_consistency": a["time_consistency"],
        "manipulation_concerns": a["manipulation_concerns"], "explanation": a["explanation"],
        "error_code": a["error_code"], "error_message": a["error_message"],
        "model": a["model"], "prompt_version": a["prompt_version"],
        "started_at": a["started_at"], "completed_at": a["completed_at"],
    }


def review_json(rv) -> dict:
    return {k: rv[k] for k in ("id", "assessment_id", "action", "final_category", "final_severity",
                                "final_urgency", "operator_label", "comment", "decided_at")}


def simulation_json(s) -> Optional[dict]:
    if s is None:
        return None
    return {k: s[k] for k in ("report_id", "incident_id", "radius_m", "recipient_count", "simulated_at")}


def report_summary(row, public: bool = False) -> dict:
    incident_id = row["incident_id"]
    if public and row["status"] not in ("published", "critical"):
        incident_id = None
    return {
        "id": row["id"], "status": row["status"], "description": row["description"],
        "has_photo": row["photo_path"] is not None,
        "latitude": row["latitude"], "longitude": row["longitude"],
        "incident_time": row["incident_time"], "submitted_at": row["submitted_at"],
        "incident_id": incident_id, "review_reason": row["review_reason"], "final": final_of(row),
    }


def on_map(pub_rows) -> bool:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=config.MAP_MAX_AGE_H)).isoformat(timespec="seconds")
    return max(r["incident_time"] for r in pub_rows) >= cutoff


def report_public(conn, row, public: bool = True) -> dict:
    d = report_summary(row, public=public)
    if public:
        d["review_reason"] = None
    else:
        a = None
        if row["current_assessment_id"]:
            a = conn.execute("SELECT * FROM assessment WHERE id = ?", (row["current_assessment_id"],)).fetchone()
        d["current_assessment"] = assessment_json(a) if a else None
    s = conn.execute("SELECT * FROM notification_simulation WHERE report_id = ?", (row["id"],)).fetchone()
    d["simulation"] = simulation_json(s)
    # Other published reports grouped into the same incident (same rule as the public map).
    d["incident_other_reports"] = 0 if row["status"] not in ("published", "critical") else conn.execute(
        "SELECT COUNT(*) FROM report WHERE incident_id = ? AND id <> ? AND status = 'published'",
        (row["incident_id"], row["id"])).fetchone()[0]
    d["on_map"] = False
    if row["status"] == "published" and row["incident_state"] == "active":
        pub = conn.execute(REPORT_SELECT + " WHERE r.status = 'published' AND r.incident_id = ? "
                           "ORDER BY r.incident_time", (row["incident_id"],)).fetchall()
        d["on_map"] = bool(pub) and on_map(pub)
    return d


def report_detail(conn, row) -> dict:
    d = report_public(conn, row, public=False)
    d["incident_state"] = row["incident_state"]
    d["incident_reports"] = [
        {"id": r["id"], "status": r["status"], "description": r["description"],
         "has_photo": r["photo_path"] is not None, "submitted_at": r["submitted_at"]}
        for r in conn.execute(
            "SELECT id, status, description, photo_path, submitted_at FROM report "
            "WHERE incident_id = ? AND id <> ? ORDER BY submitted_at", (row["incident_id"], row["id"]))]
    d["assessments"] = [assessment_json(a) for a in conn.execute(
        "SELECT * FROM assessment WHERE report_id = ? ORDER BY attempt_no", (row["id"],))]
    d["reviews"] = [review_json(rv) for rv in conn.execute(
        "SELECT * FROM review_decision WHERE report_id = ? ORDER BY decided_at", (row["id"],))]
    d["processing_started_at"] = row["processing_started_at"]
    d["updated_at"] = row["updated_at"]
    return d


def get_report_row(conn, report_id: str):
    return conn.execute(REPORT_SELECT + " WHERE r.id = ?", (report_id,)).fetchone()


def max_level(levels) -> Optional[str]:
    vals = [lv for lv in levels if lv]
    return max(vals, key=lambda lv: LEVEL_ORDER[lv]) if vals else None
