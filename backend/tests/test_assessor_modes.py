import pytest

from app import assessor, config, db, reset_demo, seed
from app.assessor import AssessInput, AssessmentError, AssessmentOutput


def _inp():
    return AssessInput("r1", 1, "Smoke from a window", None, None, 50.0, 19.9, "2026-10-03T10:00:00+00:00")


def _no_openai(*a, **k):
    raise AssertionError("OpenAI must not be called")


def _raises(code):
    def f(inp, **k):
        raise AssessmentError(code, "boom")
    return f


def test_replay_first_hit_skips_openai(monkeypatch):
    monkeypatch.setattr(config, "ASSESSOR_MODE", "replay_first")
    out = assessor._assess_mock(_inp())
    monkeypatch.setattr(assessor, "_assess_replay", lambda inp: (out, "replay:gpt-x"))
    monkeypatch.setattr(assessor, "_assess_openai", _no_openai)
    _, label = assessor.assess(_inp())
    assert label == "replay:gpt-x"


@pytest.mark.parametrize("code", ["timeout", "api_connection"])
def test_replay_first_network_failure_falls_back_to_mock(monkeypatch, code):
    monkeypatch.setattr(config, "ASSESSOR_MODE", "replay_first")
    monkeypatch.setattr(assessor, "_assess_replay", lambda inp: None)
    monkeypatch.setattr(assessor, "_assess_openai", _raises(code))
    out, label = assessor.assess(_inp())
    assert label == "mock"
    assert "timed out or was unreachable" in out.explanation


def test_replay_first_other_error_propagates(monkeypatch):
    monkeypatch.setattr(config, "ASSESSOR_MODE", "replay_first")
    monkeypatch.setattr(assessor, "_assess_replay", lambda inp: None)
    monkeypatch.setattr(assessor, "_assess_openai", _raises("refusal"))
    with pytest.raises(AssessmentError) as e:
        assessor.assess(_inp())
    assert e.value.code == "refusal"


def test_model_name_replay_first(monkeypatch):
    monkeypatch.setattr(config, "ASSESSOR_MODE", "replay_first")
    assert assessor.model_name() == "replay_first"


def test_reset_demo_reseeds(monkeypatch, tmp_path):
    up = tmp_path / "uploads"
    up.mkdir()
    (up / "old.jpg").write_bytes(b"x")
    (tmp_path / "t.db").write_bytes(b"junk")
    (tmp_path / "t.db-wal").write_bytes(b"junk")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", up)
    reset_demo.reset_demo()
    assert not (up / "old.jpg").exists()
    assert not (tmp_path / "t.db-wal").exists()
    conn = db.connect()
    try:
        assert conn.execute("SELECT COUNT(*) FROM report").fetchone()[0] == len(seed.SEEDS)
    finally:
        conn.close()


def test_reset_demo_requires_yes(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "up")
    assert reset_demo.main([]) == 1
    assert "stop the backend" in capsys.readouterr().out.lower()
    assert not (tmp_path / "t.db").exists()


def test_replay_first_openai_client_has_no_retries(monkeypatch):
    import openai
    seen = {}

    class Boom(Exception):
        pass

    class FakeClient:
        def __init__(self, **kw):
            seen.update(kw)
            raise Boom

    monkeypatch.setattr(openai, "OpenAI", FakeClient)
    with pytest.raises(Boom):
        assessor._assess_openai(_inp(), timeout=7)
    assert seen["max_retries"] == 0 and seen["timeout"] == 7
    seen.clear()
    with pytest.raises(Boom):
        assessor._assess_openai(_inp())
    assert seen["max_retries"] == 1
