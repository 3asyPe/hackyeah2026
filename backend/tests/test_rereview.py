"""Operator re-review of a critical report with a different category must regroup it (map shows the final category)."""
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import config
from app.main import app

OP = {"Authorization": f"Bearer {config.OPERATOR_TOKEN}"}
_n = [0]


def _spot():
    """A fresh location far from other tests' reports (they use longitude 20)."""
    _n[0] += 1
    return 30 + _n[0] * 0.1, 50.0


def _submit(c, lat, lon, description, minutes_ago=30):
    when = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    r = c.post("/api/reports", data={
        "submission_key": str(uuid.uuid4()), "receipt_token": "t" * 20, "latitude": lat, "longitude": lon,
        "incident_time": when.isoformat(), "description": description})
    assert r.status_code == 202, r.text
    return _wait(c, r.json()["id"])


def _wait(c, rid):
    end = time.time() + 5
    while time.time() < end:
        r = c.get(f"/api/operator/reports/{rid}", headers=OP).json()
        if r["status"] != "processing":
            return r
        time.sleep(0.05)
    raise AssertionError(f"report {rid} stuck in processing")


def _approve(c, rid, category, severity="medium", urgency="medium"):
    r = c.post(f"/api/operator/reports/{rid}/review", headers=OP,
               json={"action": "approve", "operator_label": "op", "final_category": category,
                     "final_severity": severity, "final_urgency": urgency})
    assert r.status_code == 200, r.text
    return r.json()


def _incident(c, iid):
    return c.get(f"/api/operator/incidents/{iid}", headers=OP).json()


def _critical_fire(c, lat, lon):
    rep = _submit(c, lat, lon, "fire and smoke from a building")
    assert rep["status"] == "critical", rep["status"]
    assert _incident(c, rep["incident_id"])["category"] == "fire_smoke"
    return rep


def test_rereview_alone_updates_incident_category_on_map():
    with TestClient(app) as c:
        rep = _critical_fire(c, *_spot())
        iid = rep["incident_id"]
        out = _approve(c, rep["id"], "road_hazard")
        assert out["status"] == "published"
        assert out["incident_id"] == iid  # no other incident nearby -> stays in its own incident
        inc = _incident(c, iid)
        assert (inc["state"], inc["category"]) == ("active", "road_hazard")
        marker = next(i for i in c.get("/api/incidents").json() if i["id"] == iid)
        assert marker["category"] == "road_hazard"


def test_rereview_joins_nearby_incident_of_new_category():
    with TestClient(app) as c:
        lat, lon = _spot()
        pothole = _submit(c, lat, lon, "deep pothole on the road")
        assert pothole["status"] == "published"
        target = pothole["incident_id"]
        rep = _critical_fire(c, lat + 0.0003, lon)  # ~33 m away, different category -> own incident
        old = rep["incident_id"]
        assert old != target
        out = _approve(c, rep["id"], "road_hazard")
        assert out["status"] == "published"
        assert out["incident_id"] == target
        assert _incident(c, old)["state"] == "merged"
        markers = {i["id"]: i for i in c.get("/api/incidents").json()}
        assert old not in markers
        assert markers[target]["category"] == "road_hazard"
        assert markers[target]["published_count"] == 2


def test_rereview_detaches_from_shared_incident():
    with TestClient(app) as c:
        lat, lon = _spot()
        first = _critical_fire(c, lat, lon)
        second = _critical_fire(c, lat + 0.0003, lon)
        shared = first["incident_id"]
        assert second["incident_id"] == shared
        out = _approve(c, second["id"], "road_hazard")
        assert out["status"] == "published"
        assert out["incident_id"] != shared
        inc = _incident(c, out["incident_id"])
        assert (inc["state"], inc["category"]) == ("active", "road_hazard")
        left = _incident(c, shared)
        assert (left["state"], left["category"], left["report_count"]) == ("active", "fire_smoke", 1)
        marker = next(i for i in c.get("/api/incidents").json() if i["id"] == out["incident_id"])
        assert marker["category"] == "road_hazard"


def test_rereview_same_category_keeps_incident():
    with TestClient(app) as c:
        lat, lon = _spot()
        first = _critical_fire(c, lat, lon)
        second = _critical_fire(c, lat + 0.0003, lon)
        shared = first["incident_id"]
        assert second["incident_id"] == shared
        out = _approve(c, second["id"], "fire_smoke")
        assert out["status"] == "published"
        assert out["incident_id"] == shared
        inc = _incident(c, shared)
        assert (inc["state"], inc["category"], inc["report_count"]) == ("active", "fire_smoke", 2)


def test_rereview_high_severity_simulation_uses_final_incident():
    with TestClient(app) as c:
        lat, lon = _spot()
        pothole = _submit(c, lat, lon, "deep pothole on the road")
        target = pothole["incident_id"]
        rep = _critical_fire(c, lat + 0.0003, lon)
        out = _approve(c, rep["id"], "road_hazard", severity="high", urgency="medium")
        assert out["status"] == "published" and out["incident_id"] == target
        from app.db import connect
        conn = connect()
        try:
            sim = conn.execute("SELECT incident_id FROM notification_simulation WHERE report_id = ?",
                               (rep["id"],)).fetchone()
        finally:
            conn.close()
        assert sim["incident_id"] == target
