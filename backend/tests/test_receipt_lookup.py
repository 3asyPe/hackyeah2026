import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app

TOKEN = "t" * 20


def _submit(c, key):
    when = datetime.now(timezone.utc) - timedelta(hours=1)
    return c.post("/api/reports", data={
        "submission_key": key, "receipt_token": TOKEN, "latitude": 51.0, "longitude": 19.0,
        "incident_time": when.isoformat(), "description": "fallen tree blocking the road"})


def test_lookup_by_key_with_correct_token():
    with TestClient(app) as c:
        key = str(uuid.uuid4())
        sub = _submit(c, key)
        assert sub.status_code == 202, sub.text
        # client may have stored the key in a different case/with whitespace; server normalizes it
        r = c.get(f"/api/reports/by-key/{key.upper()}", headers={"X-Receipt-Token": TOKEN})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] == sub.json()["id"]
        assert body["status"] in ("processing", "published", "critical", "in_review", "rejected", "failed")
        assert set(body) == {"id", "status"}


def test_lookup_by_key_wrong_or_missing_token():
    with TestClient(app) as c:
        key = str(uuid.uuid4())
        assert _submit(c, key).status_code == 202
        assert c.get(f"/api/reports/by-key/{key}", headers={"X-Receipt-Token": "x" * 20}).status_code == 403
        assert c.get(f"/api/reports/by-key/{key}").status_code == 403


def test_lookup_by_key_unknown():
    with TestClient(app) as c:
        r = c.get(f"/api/reports/by-key/{uuid.uuid4()}", headers={"X-Receipt-Token": TOKEN})
        assert r.status_code == 404


def test_lookup_by_key_invalid():
    with TestClient(app) as c:
        r = c.get("/api/reports/by-key/not-a-uuid", headers={"X-Receipt-Token": TOKEN})
        assert r.status_code == 422
