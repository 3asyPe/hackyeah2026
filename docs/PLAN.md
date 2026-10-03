# Implementation plan — Incident Reporter (ERD v1, fast track)

Source of truth: `../erd.md` (v1). Time budget ~1.5h → minimal tests, one smoke script.

## Stack (deviations from ERD infra, deliberate)
- `backend/` — FastAPI + **SQLite** (raw SQL schema mirroring ERD v1: CHECK constraints instead of PG ENUMs,
  composite FKs kept, numeric → REAL, uuid/timestamptz → TEXT ISO). `uploads/` dir for photos.
  OpenAI Structured Outputs; deterministic mock assessor when `OPENAI_API_KEY` is absent.
- `frontend/` — single Vite + React + TS app, react-router, react-leaflet (OSM tiles).
  Client UI at `/`, operator UI at `/operator/*`. Vite proxies `/api` → `http://localhost:8000`.
- No Docker (not installed). Run: `uvicorn app.main:app --port 8000` + `npm run dev`.

## Tasks
1. Backend schema + db layer (`schema.sql`, `db.py`) — 5 tables per ERD v1, constraints §7, indexes §10.
2. Submission: `POST /api/reports` (multipart, idempotent via submission_key + submission_hash, receipt token hash),
   creates provisional incident + report in one tx, kicks background processing.
3. Processing pipeline: evidence check → assessor (OpenAI/mock) → ASSESSMENT row → review check
   (mismatch / missing level / confidence tie) → route → grouping (200 m / 60 min, score = d·1 + Δmin·5,
   tie → smaller id) → activate provisional or merge into target → critical vs published → simulation.
4. Operator endpoints (Bearer `OPERATOR_TOKEN`, default `demo`): summary, reports, report detail, incidents,
   incident detail, review approve/reject, retry, photo.
5. Public endpoints: report status (receipt token), incidents (map), incident card.
6. Seed script: ~6 published incidents around Kraków.
7. Frontend client: Submit (camera/gallery, description, geolocation + map pick, time default now), Status (polling),
   Map (markers + card).
8. Frontend operator: token gate, Overview, Review queue, Critical, Failures, Report detail (approve/reject/retry),
   Incident detail. Polls every 3 s.
9. Smoke: run seed, submit via curl, open both UIs.

## API contract (backend ⇄ frontend)

Enums: `category` ∈ fire_smoke, road_hazard, infrastructure_damage, waste_pollution, other ·
`level` ∈ low, medium, high · `status` ∈ processing, in_review, published, critical, rejected, failed ·
`consistency` ∈ matches, mismatches, inconclusive, not_applicable ·
`photo_check` ∈ no_obvious_concerns, suspicious, inconclusive, not_applicable.
Times are ISO-8601 strings with timezone.

### Public
- `POST /api/reports` — multipart: `submission_key` (uuid, client-generated), `receipt_token` (random string,
  client-generated, ≥16 chars), `description?`, `photo?` (jpeg/png/webp ≤10 MB), `latitude`, `longitude`,
  `incident_time`. → `202 {id, status}`. Same key + same payload → same `{id,status}` (200). Same key, other payload → 409.
  A photo that carries metadata (EXIF/GPS, XMP, IPTC, comments) is stored re-encoded without it; others byte-for-byte.
- `GET /api/reports/{id}` — header `X-Receipt-Token: <token>` → `ReportPublic` (403 on bad token).
- `GET /api/reports/{id}/photo?token=<receipt_token>` → image bytes.
- `DELETE /api/reports/{id}` — header `X-Receipt-Token` → 204. Deletes the report, photo, assessments, reviews,
  simulation and any incident left without reports. 403 bad token, 404 unknown, 409 while `processing`.
- `GET /api/incidents` → `IncidentMarker[]` = `{id, category, latitude, longitude, incident_time, published_count, max_severity}`
- `GET /api/incidents/{id}` → `{...IncidentMarker, reports: [{id, incident_time, severity, urgency}]}` (published only; no description or photo)
- `GET /api/privacy` → `{retention_days, rejected_retention_days, assessor_mode}` (shown on the privacy notice)
- `GET /api/health` → `{ok, assessor, mode: "openai"|"replay"|"mock", model, recorded_samples}`
- `GET /api/samples` → `[{id, title, description, photo_url, latitude, longitude, credit, recorded}]` bundled demo
  reports (`backend/samples/`); `recorded` = a replay fixture exists. `GET /api/samples/{id}/photo` → the raw file
  bytes (404 if none). Submitting them unchanged gets the recorded assessment in replay mode.

### Operator (header `Authorization: Bearer <token>`; 401 otherwise)
- `GET /api/operator/summary` → `{processing, in_review, published, critical, rejected, failed, active_incidents}`
- `GET /api/operator/reports?status=<status>` → `ReportSummary[]` newest first
- `GET /api/operator/reports/{id}` → `ReportDetail`
- `GET /api/operator/reports/{id}/photo` → image bytes (use `?token=` query alternative for `<img>`: `/api/operator/reports/{id}/photo?token=<operator token>`)
- `GET /api/operator/incidents?state=active` → `IncidentOp[]` = `{id, state, category, latitude, longitude, incident_time, created_at, merged_into_id, report_count, published_count, critical_count}`
- `GET /api/operator/incidents/{id}` → `{...IncidentOp, reports: ReportDetail[]}`
- `POST /api/operator/reports/{id}/review` JSON `{action: "approve"|"reject", final_category?, final_severity?, final_urgency?, operator_label, comment?}` → `ReportDetail` (409 if not in_review/failed/critical... see rules)
- `POST /api/operator/reports/{id}/retry` → `ReportDetail` (status becomes processing; poll)

### Shapes
```
Final        = {category, severity, urgency, source: "model"|"operator"} | null
Assessment   = {id, attempt_no, outcome: "succeeded"|"failed", category, severity, urgency,
                severity_confidence: {low,medium,high}|null, urgency_confidence: {low,medium,high}|null,
                photo_description_match, scene_plausibility, time_consistency, manipulation_concerns,
                explanation, error_code, error_message, model, prompt_version, started_at, completed_at}
Review       = {id, assessment_id, action, final_category, final_severity, final_urgency, operator_label, comment, decided_at}
Simulation   = {report_id, incident_id, radius_m, recipient_count, simulated_at} | null
ReportSummary= {id, status, description, has_photo, latitude, longitude, incident_time, submitted_at,
                incident_id, review_reason, final}
ReportPublic = ReportSummary + {current_assessment: Assessment|null, simulation}
ReportDetail = ReportPublic + {incident_state, assessments: Assessment[], reviews: Review[], processing_started_at, updated_at}
```
`incident_id` is exposed publicly only when status ∈ {published, critical} (provisional incidents are private).
