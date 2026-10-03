import json

import pytest

from app import config, record_fixtures
from app.assessor import AssessmentOutput
from app.processing import review_reasons


def row(**kw):
    a = {"photo_description_match": "matches", "category": "fire", "severity": "high", "urgency": "high",
         "severity_low_confidence": 5, "severity_medium_confidence": 5, "severity_high_confidence": 90,
         "urgency_low_confidence": 5, "urgency_medium_confidence": 5, "urgency_high_confidence": 90,
         "scene_plausibility": "no_obvious_concerns", "time_consistency": "no_obvious_concerns",
         "manipulation_concerns": "no_obvious_concerns"}
    a.update(kw)
    return a


def test_clean():
    assert review_reasons(row()) == []


@pytest.mark.parametrize("field", ["scene_plausibility", "manipulation_concerns"])
def test_suspicious_photo(field):
    assert "suspicious_photo" in review_reasons(row(**{field: "suspicious"}))


def test_time_consistency_alone_ignored():
    assert review_reasons(row(time_consistency="suspicious")) == []


def test_low_confidence():
    r = review_reasons(row(severity_high_confidence=45, severity_low_confidence=30, severity_medium_confidence=25))
    assert r == ["low_confidence"]
    r = review_reasons(row(urgency_high_confidence=45, urgency_low_confidence=30, urgency_medium_confidence=25))
    assert r == ["low_confidence"]


def test_low_confidence_both_axes_once():
    kw = {f"{p}_{l}_confidence": v for p in ("severity", "urgency") for l, v in (("low", 30), ("medium", 25), ("high", 45))}
    assert review_reasons(row(**kw)) == ["low_confidence"]


def test_confidence_exactly_floor():
    kw = dict(severity_high_confidence=config.MIN_TOP_CONFIDENCE, severity_low_confidence=30, severity_medium_confidence=20)
    assert "low_confidence" not in review_reasons(row(**kw))


def test_severity_null():
    r = review_reasons(row(severity=None, severity_low_confidence=None, severity_medium_confidence=None,
                           severity_high_confidence=None))
    assert "severity_undetermined" in r and "low_confidence" not in r


def test_tie_low():
    r = review_reasons(row(severity_low_confidence=45, severity_medium_confidence=45, severity_high_confidence=10))
    assert "severity_confidence_tie" in r and "low_confidence" in r


FIXTURES = sorted((config.FIXTURES_DIR).glob("*.json"))


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem[:8])
def test_fixture_routing(path):
    fx = json.loads(path.read_text())
    route = record_fixtures._route(AssessmentOutput.model_validate(fx["output"]))
    if fx.get("sample_id") == "mismatch":
        assert route.startswith("in_review") and "photo_description_mismatch" in route
    else:
        assert not route.startswith("in_review"), (fx.get("sample_id"), route)
