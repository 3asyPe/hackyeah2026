from fastapi.testclient import TestClient

from app.main import app
from tests.test_api import OP, _published


def test_public_report_hides_assessment_and_reason():
    with TestClient(app) as c:
        rep = _published(c, description="car accident on the road")
        pub = c.get(f"/api/reports/{rep['id']}", headers={"X-Receipt-Token": "t" * 20}).json()
        assert "current_assessment" not in pub
        assert pub["review_reason"] is None
        op = c.get(f"/api/operator/reports/{rep['id']}", headers=OP).json()
        assert op["current_assessment"] is not None
        assert "review_reason" in op
