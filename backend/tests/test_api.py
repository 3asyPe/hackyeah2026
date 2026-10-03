import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import config
from app.main import app

OP = {"Authorization": f"Bearer {config.OPERATOR_TOKEN}"}
_n = [0]


def _submit(c, hours_ago=1.0, description="car accident on the road", lat=None):
    _n[0] += 1
    when = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    return c.post("/api/reports", data={
        "submission_key": str(uuid.uuid4()), "receipt_token": "t" * 20,
        "latitude": lat if lat is not None else 10 + _n[0] * 0.1, "longitude": 20.0,
        "incident_time": when.isoformat(), "description": description})


def _wait(c, rid, statuses=("published", "critical", "in_review", "rejected", "failed")):
    end = time.time() + 5
    while time.time() < end:
        r = c.get(f"/api/operator/reports/{rid}", headers=OP).json()
        if r["status"] in statuses:
            return r
        time.sleep(0.05)
    raise AssertionError(f"report {rid} stuck in {r['status']}")


def _review(c, rid, action):
    return c.post(f"/api/operator/reports/{rid}/review", headers=OP,
                  json={"action": action, "operator_label": "op", "final_category": "road_hazard",
                        "final_severity": "high", "final_urgency": "medium"})


def _published(c, **kw):
    r = _submit(c, **kw)
    assert r.status_code == 202, r.text
    rep = _wait(c, r.json()["id"])
    assert rep["status"] == "published", rep["status"]
    return rep


def test_incident_time_age_limit():
    with TestClient(app) as c:
        r = _submit(c, hours_ago=73)
        assert r.status_code == 422
        assert "72 hours" in r.json()["detail"]
        assert _submit(c, hours_ago=71).status_code == 202


def test_retract_published_removes_from_map():
    with TestClient(app) as c:
        rep = _published(c)
        iid = rep["incident_id"]
        assert any(i["id"] == iid for i in c.get("/api/incidents").json())
        r = _review(c, rep["id"], "reject")
        assert r.status_code == 200 and r.json()["status"] == "rejected"
        assert all(i["id"] != iid for i in c.get("/api/incidents").json())


def test_approve_published_is_409():
    with TestClient(app) as c:
        rep = _published(c)
        assert _review(c, rep["id"], "approve").status_code == 409


def test_old_incident_hidden_from_map():
    with TestClient(app) as c:
        rep = _published(c, hours_ago=30)
        iid = rep["incident_id"]
        assert all(i["id"] != iid for i in c.get("/api/incidents").json())
        assert c.get(f"/api/incidents/{iid}").status_code == 404
        assert c.get(f"/api/operator/incidents/{iid}", headers=OP).status_code == 200


def test_executor_processes_and_retries():
    with TestClient(app) as c:
        rid = _submit(c).json()["id"]
        assert _wait(c, rid)["status"] in ("published", "critical", "in_review")
        fid = _submit(c, description="flaky thing").json()["id"]
        assert _wait(c, fid)["status"] == "failed"
        assert c.post(f"/api/operator/reports/{fid}/retry", headers=OP).status_code == 200
        assert _wait(c, fid, ("published", "critical", "in_review", "failed"))["status"] != "processing"
