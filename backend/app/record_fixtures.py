"""Record real OpenAI assessments of the bundled samples into fixtures/replay/ for the replay assessor.

Run: .venv/bin/python -m app.record_fixtures [--only id,id] [--force]   (needs OPENAI_API_KEY; costs API calls)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone

from . import config, samples
from .assessor import AssessInput, AssessmentError, _assess_openai, _normalize
from .processing import review_reasons


def _route(out) -> str:
    """Where processing.py would send this output (same review rules, then critical vs published)."""
    row = {"photo_description_match": out.photo_description_match, "category": out.category,
           "severity": out.severity, "urgency": out.urgency}
    for name, conf in (("severity", out.severity_confidence), ("urgency", out.urgency_confidence)):
        for lvl in ("low", "medium", "high"):
            row[f"{name}_{lvl}_confidence"] = getattr(conf, lvl) if conf else None
    if reasons := review_reasons(row):
        return f"in_review ({', '.join(reasons)})"
    return "critical" if (out.severity, out.urgency) == ("high", "high") else "published"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", help="comma-separated sample ids")
    ap.add_argument("--force", action="store_true", help="re-record samples that already have a fixture")
    args = ap.parse_args()
    if not config.OPENAI_API_KEY:
        print("OPENAI_API_KEY is not set (env or backend/.env); nothing recorded.", file=sys.stderr)
        return 2
    todo = samples.load()
    if not todo:
        print(f"No samples in {config.SAMPLES_DIR / 'samples.json'}", file=sys.stderr)
        return 2
    if args.only:
        wanted = {x.strip() for x in args.only.split(",") if x.strip()}
        if unknown := wanted - {s["id"] for s in todo}:
            print(f"Unknown sample id(s): {', '.join(sorted(unknown))}", file=sys.stderr)
            return 2
        todo = [s for s in todo if s["id"] in wanted]

    config.FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Recording with {config.OPENAI_MODEL} into {config.FIXTURES_DIR}")
    failed = 0
    for s in todo:
        sid = s["id"]
        key = samples.key(s)
        if key is None:
            print(f"{sid:24} SKIP photo file missing or invalid: {s.get('photo')}")
            failed += 1
            continue
        path = config.FIXTURES_DIR / f"{key}.json"
        if path.exists() and not args.force:
            print(f"{sid:24} skip (already recorded, use --force)")
            continue
        photo = samples.photo_path(s)
        desc = (s.get("description") or "").strip() or None
        inp = AssessInput(
            report_id=f"sample-{sid}", attempt_no=1, description=desc,
            photo_path=str(photo) if photo else None,
            photo_media_type=samples.MEDIA_TYPES[photo.suffix.lower()] if photo else None,
            latitude=float(s["latitude"]), longitude=float(s["longitude"]),
            incident_time=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        try:
            out = _normalize(_assess_openai(inp), photo is not None, desc is not None)
        except AssessmentError as e:
            print(f"{sid:24} FAILED {e.code}: {e.message}")
            failed += 1
            continue
        fixture = {
            "key": key, "sample_id": sid, "model": config.OPENAI_MODEL,
            "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "input": {"description": desc,
                      "photo_sha256": hashlib.sha256(photo.read_bytes()).hexdigest() if photo else None},
            "output": out.model_dump(),
        }
        path.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{sid:24} {out.category or '-':22} sev={out.severity or '-':6} urg={out.urgency or '-':6} "
              f"match={out.photo_description_match:15} -> {_route(out)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
