"""Deleting reports after an operator re-review regrouped them: no merge chains, no leftover location stubs."""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import privacy
from app.db import connect
from app.main import app
from test_rereview import _approve, _critical_fire

_n = [0]


def _spot():
    """A fresh location away from other tests' reports."""
    _n[0] += 1
    return -30 - _n[0] * 0.1, 50.0


def _delete(c, rid):
    return c.delete(f"/api/reports/{rid}", headers={"X-Receipt-Token": "t" * 20})


def _q(sql, *args):
    conn = connect()
    try:
        return [tuple(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


def _incidents_at(rep):
    return _q("SELECT id, state FROM incident WHERE latitude = ? AND longitude = ? AND incident_time = ?",
              rep["latitude"], rep["longitude"], rep["incident_time"])


def _chain(c):
    """A and B share I1 (B's own incident is a merged stub under I1); B moves to a new incident, then A's
    re-review reopens I1 and merges it into B's incident."""
    lat, lon = _spot()
    a = _critical_fire(c, lat, lon)
    b = _critical_fire(c, lat + 0.0002, lon)
    i1 = a["incident_id"]
    assert b["incident_id"] == i1
    i3 = _approve(c, b["id"], "road_hazard")["incident_id"]
    assert i3 != i1
    assert _approve(c, a["id"], "road_hazard")["incident_id"] == i3
    return a, b, i1, i3


def test_regroup_merge_does_not_chain():
    with TestClient(app) as c:
        a, b, i1, i3 = _chain(c)
        # every merged incident points straight at an incident that is not merged itself
        assert _q("SELECT s.id FROM incident s JOIN incident p ON p.id = s.merged_into_id "
                  "WHERE p.state = 'merged'") == []
        assert _q("SELECT state, merged_into_id FROM incident WHERE id = ?", i1) == [("merged", i3)]


def test_delete_after_chained_regroup():
    with TestClient(app) as c:
        a, b, i1, i3 = _chain(c)
        assert _delete(c, a["id"]).status_code == 204
        assert _delete(c, b["id"]).status_code == 204
        for rep in (a, b):
            assert _incidents_at(rep) == []
        assert _q("SELECT id FROM incident WHERE id IN (?, ?)", i1, i3) == []
        assert _q("SELECT s.id FROM incident s LEFT JOIN incident p ON p.id = s.merged_into_id "
                  "WHERE s.merged_into_id IS NOT NULL AND p.id IS NULL") == []


def test_delete_tolerates_chain_from_older_database():
    with TestClient(app) as c:
        a, b, i1, i3 = _chain(c)
        # recreate the chain older versions left behind: stub(B) -> I1 -> I3
        conn = connect()
        try:
            conn.execute("UPDATE incident SET merged_into_id = ? WHERE state = 'merged' AND latitude = ? "
                         "AND longitude = ? AND incident_time = ?",
                         (i1, b["latitude"], b["longitude"], b["incident_time"]))
        finally:
            conn.close()
        assert _delete(c, a["id"]).status_code == 204
        assert _delete(c, b["id"]).status_code == 204
        for rep in (a, b):
            assert _incidents_at(rep) == []
        assert _q("SELECT id FROM incident WHERE id IN (?, ?)", i1, i3) == []


def _expire(*reps):
    old = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    conn = connect()
    try:
        for rep in reps:
            conn.execute("UPDATE report SET updated_at = ? WHERE id = ?", (old, rep["id"]))
    finally:
        conn.close()


def test_purge_after_chained_regroup():
    with TestClient(app) as c:
        a, b, i1, i3 = _chain(c)
        _expire(a, b)
        assert privacy.purge_expired() == 2
        assert _q("SELECT id FROM report WHERE id IN (?, ?)", a["id"], b["id"]) == []
        for rep in (a, b):
            assert _incidents_at(rep) == []


def test_purge_continues_past_failing_report(monkeypatch):
    with TestClient(app) as c:
        lat, lon = _spot()
        bad = _critical_fire(c, lat, lon)
        good = _critical_fire(c, lat + 1, lon)
        _expire(bad, good)
        real = privacy.delete_report_in_tx

        def flaky(conn, rid):
            if rid == bad["id"]:
                raise RuntimeError("boom")
            return real(conn, rid)

        monkeypatch.setattr(privacy, "delete_report_in_tx", flaky)
        assert privacy.purge_expired() == 1
        assert _q("SELECT id FROM report WHERE id IN (?, ?)", bad["id"], good["id"]) == [(bad["id"],)]
        monkeypatch.undo()
        assert _delete(c, bad["id"]).status_code == 204


def test_delete_moved_report_removes_its_stub():
    with TestClient(app) as c:
        lat, lon = _spot()
        a = _critical_fire(c, lat, lon)
        b = _critical_fire(c, lat + 0.0002, lon)
        assert b["incident_id"] == a["incident_id"]
        moved = _approve(c, b["id"], "road_hazard")["incident_id"]
        assert moved != a["incident_id"]
        assert _delete(c, b["id"]).status_code == 204
        assert _incidents_at(b) == []
        assert _q("SELECT state FROM incident WHERE id = ?", a["incident_id"]) == [("active",)]
