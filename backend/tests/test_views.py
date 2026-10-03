from fastapi.testclient import TestClient

from app.main import app
from tests.test_api import OP, _published, _submit, _wait


def test_public_report_hides_assessment_and_reason():
    with TestClient(app) as c:
        rep = _published(c, description="car accident on the road")
        pub = c.get(f"/api/reports/{rep['id']}", headers={"X-Receipt-Token": "t" * 20}).json()
        assert "current_assessment" not in pub
        assert pub["review_reason"] is None
        op = c.get(f"/api/operator/reports/{rep['id']}", headers=OP).json()
        assert op["current_assessment"] is not None
        assert "review_reason" in op


def test_in_review_report_hides_reason_and_assessment_from_public():
    with TestClient(app) as c:
        r = _submit(c, description="mismatch car accident")
        rep = _wait(c, r.json()["id"])
        assert rep["status"] == "in_review"
        pub = c.get(f"/api/reports/{rep['id']}", headers={"X-Receipt-Token": "t" * 20}).json()
        assert pub["review_reason"] is None
        assert "current_assessment" not in pub
        op = c.get(f"/api/operator/reports/{rep['id']}", headers=OP).json()
        assert op["review_reason"]
