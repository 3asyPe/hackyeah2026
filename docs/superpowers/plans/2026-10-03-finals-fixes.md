# Finals fixes — implementation plan

Branch: `finals-fixes`. This plan has no separate spec. The authority is the design reviewed in the session on 2026-10-03, summarised under Global Constraints. It covers the **fixes** part only. Feature #1 (the Live Investigation Trace) and feature #2 (the Storm Wall) come later as their own plans.

Goal: close the holes that would embarrass the team in a live finals demo, without breaking the demo that works today.

## Global Constraints

- **Leave `AssessmentOutput` and the replay `fixture_key` alone.** They live in `backend/app/assessor.py`, and changing either breaks every recorded fixture in `backend/fixtures/replay/`.
- **Replay and mock demo modes must keep working.** `backend/smoke.sh` must pass against a backend started in replay mode with a temporary `DATA_DIR`/`UPLOAD_DIR`, updated only where this plan changes a contract.
- **Backend Python lives in `backend/.venv`.** Run Python via `backend/.venv/bin/python`. Add new Python dependencies to `backend/requirements.txt` with pinned versions, then install them with `uv pip install -r requirements.txt` inside `backend/`.
- **Backend tests go in `backend/tests/`, using pytest.**
  - Tests must never touch `backend/data` or `backend/uploads`. Point `DATA_DIR`, `DB_PATH` and `UPLOAD_DIR` at a tmp dir *before* `app.config` is imported, from a `backend/tests/conftest.py`.
  - Run them from `backend/` with `.venv/bin/python -m pytest -q`.
- **Frontend checks must pass after any frontend change.** From `frontend/`, run `npx tsc -b` and `npm run lint`.
- **Status values stay as they are:** processing, in_review, published, critical, rejected, failed.
- **Commit messages** end with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Match the surrounding code style.** That means compact code, comments only where they add something, and the existing naming.

---

## Task 1: Routing uses the photo checks and a confidence floor (F1)

**Files:** `backend/app/processing.py`, `backend/app/record_fixtures.py`, `backend/app/config.py`, `backend/requirements.txt`, new `backend/tests/conftest.py`, new `backend/tests/test_routing.py`.

**Changes to `review_reasons(a)` in `processing.py`.** Keep the existing reasons and their order, then append:
- `suspicious_photo` when `a["scene_plausibility"] == "suspicious"` or `a["manipulation_concerns"] == "suspicious"`.
  - `time_consistency` is deliberately **not** used. Every recorded fixture has `time_consistency: "suspicious"`, because the samples were recorded in the evening and replay ignores the claimed time. A later deterministic sun check will own timing.
- `low_confidence` when severity confidence is present and `max(severity_low/medium/high_confidence) < config.MIN_TOP_CONFIDENCE`, or the same for urgency.
  - Emit the reason once, even if both axes are low.
  - New config value: `MIN_TOP_CONFIDENCE = _f("MIN_TOP_CONFIDENCE", 50)`.

`review_reasons` must keep accepting either a `sqlite3.Row` or a plain dict. Use `a[...]` key access only, with no `.get` that a Row lacks.

**Changes to `record_fixtures.py`.**
- `_route(out)` must add `scene_plausibility`, `time_consistency` and `manipulation_concerns` to the dict it builds. Without them, the new rules hit a KeyError.
- Add a `--at ISO8601` option. When it is given, it is the `incident_time` sent to the model instead of "now" (UTC). Parse it with `datetime.fromisoformat` after replacing a trailing `Z`, and assume UTC when there is no timezone.
- Document it in the module docstring. The purpose is to re-record the fixtures at local noon so `time_consistency` is not "suspicious".
- Do NOT re-record anything. Re-recording needs an API key and is the user's call.

**Test setup.**
- Add `pytest==8.4.2` to `requirements.txt` and install it. If that exact version is not available, use the latest 8.x and pin it.
- `conftest.py` sets env vars for a tmp dir (`tempfile.mkdtemp()`), plus `ASSESSOR=mock` and `MOCK_DELAY_S=0`, before any `app.*` import.

**Tests in `test_routing.py`.** Use dict rows with all assessment keys present.
- A clean high/high assessment → `[]`.
- `scene_plausibility` suspicious → contains `suspicious_photo`.
- `manipulation_concerns` suspicious → contains `suspicious_photo`.
- **Only** `time_consistency` suspicious → `[]`.
- Top severity confidence 45 → `low_confidence`.
- Top confidence exactly 50 → no `low_confidence`.
- Severity null → `severity_undetermined` and no `low_confidence`.
- A tie at 45/45 still gives `severity_confidence_tie` plus `low_confidence`.
- Every fixture JSON in `backend/fixtures/replay/` except `mismatch` routes the same way it did before: run `record_fixtures._route` on its output and assert it does not start with `in_review`. The mismatch fixture is still in_review because of `photo_description_mismatch`. Load each with `AssessmentOutput.model_validate`.

---

## Task 2: API fixes: retract, time bounds, bounded assessment pool (F2, F3, F5)

**Files:** `backend/app/main.py`, `backend/app/config.py`, new `backend/app/jobs.py`, new `backend/tests/test_api.py`.

### F2 Retract

- An operator may **reject** a `published` report. Approving a `published` report stays a 409.
  - Implement it as `REVIEWABLE` plus a separate check: `if r["status"] == "published" and body.action != "reject": 409 "published reports can only be retracted (reject)"`.
- On reject the report becomes `rejected`, as today, with the review_decision row.
- No other change is needed for the map. `/api/incidents` already lists only incidents that have published reports, so an incident whose only published report was retracted disappears automatically. Verify this with a test.

### F3 Time bounds

- New config values:
  - `MAX_INCIDENT_AGE_H = _f("MAX_INCIDENT_AGE_H", 72)`
  - `MAP_MAX_AGE_H = _f("MAP_MAX_AGE_H", 24)`
- `POST /api/reports` rejects an `incident_time` older than now minus `MAX_INCIDENT_AGE_H` hours. It returns 422 with the message `incident_time is more than 72 hours in the past`, using the configured value in the text.
- `GET /api/incidents` and `GET /api/incidents/{id}` hide incidents whose **latest** published report `incident_time` is older than now minus `MAP_MAX_AGE_H` hours. The detail endpoint returns 404 for those. Operator endpoints are unaffected.

### F5 Bounded assessment pool

- New module `app/jobs.py`:
  - holds a module-level `ThreadPoolExecutor(max_workers=config.ASSESS_WORKERS, thread_name_prefix="assess")`, created lazily;
  - provides `submit(report_id: str) -> None`, which schedules `processing.process_report(report_id)` and logs any exception the future raises;
  - provides `shutdown() -> None`, which calls `executor.shutdown(wait=False, cancel_futures=True)` if the executor was created.
- New config value: `ASSESS_WORKERS = int(_f("ASSESS_WORKERS", 4))`.
- `submit_report` and `operator_retry` call `jobs.submit(report_id)` instead of `background.add_task(process_report, ...)`. Remove the now-unused `BackgroundTasks` params and imports.
- The `lifespan` calls `jobs.shutdown()` after `yield`.
- Cancelled or lost queued work stays covered by `recover_interrupted()` at the next start. That is the existing behaviour; do not change it.

### Tests in `test_api.py`

Use `fastapi.testclient.TestClient(app)` inside a `with` block so the lifespan runs.

- Submissions use description-only reports with mock keywords (e.g. "car accident") so no photo is needed. Wait for processing by polling the operator endpoint (Bearer `config.OPERATOR_TOKEN`) for up to 5 s.
- **Tests:**
  1. An `incident_time` 73 h ago → 422; 71 h ago → 202.
  2. A published report can be rejected (200, status `rejected`), and its incident disappears from `/api/incidents`.
  3. Approving a published report → 409.
  4. An incident whose only published report has an `incident_time` 30 h ago is absent from `/api/incidents`, and `/api/incidents/{id}` returns 404.
  5. Submit → the report reaches a terminal status, which proves the executor path works. Retry on a failed report (description contains `flaky`) also reaches a terminal status.

---

## Task 3: Citizen view shows status only; operators can retract in the UI (F4 + F2 UI)

**Files:** `backend/app/views.py`, `backend/smoke.sh`, `frontend/src/api.ts`, `frontend/src/client/StatusPage.tsx`, `frontend/src/operator/ReportDetailPage.tsx`, `frontend/src/components/ui.tsx` (only if needed), new `backend/tests/test_views.py`.

### Backend: `views.report_public(conn, row, public=True)`

- When `public` is true, the JSON must **not** contain a `current_assessment` key. Do not add any replacement field: the model explanation stays operator-only too, because it can name the fake checks.
- `review_reason` is `None` when `public` is true.
- `report_detail` (operator) is unchanged and still includes `current_assessment` and `review_reason`.

### Frontend `api.ts`

- Move `current_assessment: Assessment | null` from `ReportPublic` to `ReportDetail`.
- Keep `review_reason` on `ReportSummary`, since the operator lists use it.

### `StatusPage.tsx`

- Remove the "Model assessment" card.
- The in_review banner always shows the generic text: "An operator will check this report before it is published."
- Keep "Final classification" (`report.final`), the simulation note, the banners and "Your submission".

### `ReportDetailPage.tsx`

- For `r.status === 'published'`, show the decision panel with **only** a Reject button, labelled "Retract (reject)".
- Next to it, a one-line hint: "Removes this report from the public map. The incident disappears if no published reports remain."
- `canRetry` is unchanged. The approve controls are hidden for published reports.

### `smoke.sh`

The "no confidence" check currently reads `current_assessment` from the public endpoint. Change it to read the same field from `GET /api/operator/reports/$RID` with the Bearer token, and assert that the public JSON has no `current_assessment` key.

### Tests in `test_views.py`

Use a seeded or submitted report:
- the public JSON has no `current_assessment` and has `review_reason` None;
- the operator detail JSON has both.

---

## Task 4: Demo ops: replay_first mode, safe seed, reset command, runbook (F6)

**Files:** `backend/app/config.py`, `backend/app/assessor.py`, `backend/app/main.py` (health and startup log only), `backend/app/seed.py`, new `backend/app/reset_demo.py`, `backend/.env.example`, `README.md`, new `docs/finals-runbook.md`, `frontend/src/api.ts`, `frontend/src/components/ui.tsx`, new `backend/tests/test_assessor_modes.py`.

### New assessor mode `replay_first`

- `ASSESSOR` accepts `replay_first`.
- `ASSESSOR_MODE` resolution:
  - `auto` stays `openai` with a key and `replay` without one.
  - `replay_first` requires a key at startup, with the same check as `openai`.
- In `assess()`, mode `replay_first`:
  1. Try `_assess_replay(inp)`. On a hit, use it (label `replay:<model>`).
  2. Otherwise call `_assess_openai(inp)` with label `config.OPENAI_MODEL`.
  3. If that raises `AssessmentError` with code `timeout` or `api_connection`, fall back to `_assess_mock(inp)` with label `mock`. The mock explanation must say no real model answered (network failure). Any other error propagates as today.
- New config value: `REPLAY_FIRST_TIMEOUT_S = _f("REPLAY_FIRST_TIMEOUT_S", 15)`, used as the OpenAI client timeout in this mode only. Pass the timeout into `_assess_openai` via an optional parameter, so the default behaviour is unchanged.
- `model_name()` returns `replay_first` for this mode.
- `/api/health` reports `mode: "replay_first"`, `model: OPENAI_MODEL`, and the recorded sample count.

### Frontend

- `AssessorMode` in `api.ts` adds `'replay_first'`.
- The `ui.tsx` badge shows "AI: recorded samples + live {model}" for that mode, styled like `replay`.

### `seed.py`

- Move `crit-1` to latitude 50.0832, longitude 19.9013, about 2.5 km from the fire sample at 50.065/19.92. A live fire-sample submission must not merge into the seed fire.
- Nothing else changes.

### New `app/reset_demo.py`

Run it as `python -m app.reset_demo [--yes]`.

- It refuses to run without `--yes`, printing what it would delete.
- With `--yes` it:
  1. deletes `config.DB_PATH` and its `-wal`/`-shm` siblings;
  2. deletes every file in `config.UPLOAD_DIR` (not the dir itself);
  3. calls `seed.seed()`, which calls `init_db`.
- Its docstring and its stdout say: **stop the backend first.** The running server keeps the old DB handle and in-process queue.
- It must never touch anything outside `DB_PATH`, its siblings and `UPLOAD_DIR`.

### `README.md`

Add `replay_first` to the `ASSESSOR` docs line, and add a one-line "Reset before a demo: `.venv/bin/python -m app.reset_demo --yes` (backend stopped)".

### `.env.example`

Add commented lines:
- `# ASSESSOR=replay_first  # samples replay, anything else goes to OpenAI (needs key)`
- `# OPERATOR_TOKEN=<long random string for public demos>`

### `docs/finals-runbook.md`

A short checklist:
1. Stop the backend and run `reset_demo --yes` at most 5 minutes before going on stage.
2. Start `uvicorn` **without** `--reload`, with `ASSESSOR=replay_first` and a strong `OPERATOR_TOKEN`.
3. Check `/api/health`.
4. Dry-run the sample fire (expect `critical`), then reset again.
5. Use a phone hotspot instead of venue Wi-Fi.
6. Keep `docs/demo.webm` cued as the fallback.
7. Note that sections for the trace and storm demos will be added later.

### Tests in `test_assessor_modes.py`

Monkeypatch `config.ASSESSOR_MODE` and the internals:
- **replay_first** with a fixture hit returns the replay label and never calls OpenAI (monkeypatch `_assess_openai` to raise if called).
- **replay_first** with a miss and OpenAI raising `AssessmentError("timeout", ...)` returns label `mock`.
- **replay_first** with a miss and OpenAI raising `AssessmentError("refusal", ...)` re-raises.
- **reset_demo** with tmp paths deletes the DB and upload files and re-seeds: the report count equals `len(seed.SEEDS)`.
