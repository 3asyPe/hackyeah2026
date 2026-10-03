from fastapi.testclient import TestClient

from app.main import app
from tests.test_api import OP, _published, _review, _submit, _wait


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


def _pub(c, rid):
    return c.get(f"/api/reports/{rid}", headers={"X-Receipt-Token": "t" * 20}).json()


def test_fresh_published_report_is_on_map():
    with TestClient(app) as c:
        rep = _published(c, description="car accident on the road")
        assert _pub(c, rep["id"])["on_map"] is True
        assert c.get(f"/api/operator/reports/{rep['id']}", headers=OP).json()["on_map"] is True


def test_old_published_report_is_not_on_map():
    with TestClient(app) as c:
        rep = _published(c, hours_ago=30)
        assert _pub(c, rep["id"])["on_map"] is False


def test_critical_report_is_not_on_map():
    with TestClient(app) as c:
        rep = _wait(c, _submit(c, description="fire in the building").json()["id"])
        assert rep["status"] == "critical"
        assert _pub(c, rep["id"])["on_map"] is False


def test_retracted_report_is_not_on_map():
    with TestClient(app) as c:
        rep = _published(c, description="car accident on the road")
        assert _review(c, rep["id"], "reject").status_code == 200
        pub = _pub(c, rep["id"])
        assert pub["status"] == "rejected"
        assert pub["on_map"] is False
