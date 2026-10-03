# Incident Reporter (hackathon build, ERD v1)

People report a local incident from their phone with a photo, a description, the place and the time. A model
(OpenAI Structured Outputs, or a keyword mock when no API key is set) classifies it by category, severity and
urgency and checks the photo against the description. The report is then routed:

- **published**: grouped into a nearby incident (200 m / 60 min, same category) and shown on the public map.
  High severity also creates a *simulated* nearby-user notification.
- **critical** (high severity and high urgency): sent to the operator dashboard with a *simulated* 112 escalation
  It stays off the public map until an operator approves it.
- **in_review**: held for an operator when there is no evidence, the photo and description don't match, a level
  couldn't be determined, or two confidence values tie.
- **failed**: the model call failed. An operator can retry it, which creates a new assessment attempt.

Operators work in a desktop dashboard with an Overview, Critical, Review and Failures queues, report detail
(every assessment attempt, review history, approve/reject/retry) and incident detail.

```
backend/       FastAPI + SQLite, background processing, OpenAI or mock assessor, seed + smoke.sh
frontend/      Vite + React + TS. Client (mobile) at /, operator (desktop) at /operator
docs/erd-v1.md data model and processing rules (source of truth)
docs/PLAN.md   implementation plan + API contract (authoritative JSON shapes)
```

## Run it

You need Python 3.12 via `uv` and Node 20+ with npm.

**Backend** (port 8000):

```bash
cd backend
uv venv --python 3.12 && uv pip install -r requirements.txt
cp .env.example .env          # optional: set OPENAI_API_KEY=sk-... ; empty -> mock assessor
.venv/bin/python -m app.seed  # demo data around Kraków (idempotent; second run skips)
.venv/bin/uvicorn app.main:app --port 8000 --reload
```

`.env` keys are `OPENAI_API_KEY`, `OPENAI_MODEL` (`.env.example` uses `gpt-6-luna`; code default `gpt-4.1-mini`. Only `gpt-4*` models get `temperature=0`) and `OPERATOR_TOKEN` (default `demo`).
To start from a clean state, stop the server and run `rm -rf data uploads`, then seed again.
`GET /api/health` returns `{ok, assessor}` and tells you whether the mock or OpenAI is active.

**Frontend** (port 5173; Vite proxies `/api` to :8000):

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173  (client)  ·  http://localhost:5173/operator (token: demo)
# production build: npm run build && npx vite preview --port 4173   (preview also proxies /api)
```

**Smoke test** (needs the backend running with the mock assessor):

```bash
cd backend && ./smoke.sh http://localhost:8000
```

## Demo script (about 5 minutes, mock assessor)

Open the client in a phone-sized window at http://localhost:5173 and the operator view in a desktop window at
http://localhost:5173/operator.

1. **Critical:** on Report, choose any photo, type `big fire near the school` and submit. The status page shows
   *Processing* for about 1 s, then **Critical** with the *SIMULATED 112* banner, confidence bars and photo checks.
2. **Published and on the map:** submit `trash on the sidewalk` from the default location. It is **Published** and
   joins the seeded waste incident near the Market Square. Tap *View incident on map* and the card shows 2 reports.
3. **Operator:** enter token `demo`. The Overview shows the counters and active incidents, with critical ones first.
   Open **Review**, pick the *photo/description mismatch* report, enter an operator label and **Approve**. It
   becomes Published with source "Operator decision" and the Review badge goes down by one.
4. **Failures and retry:** open **Failures**, open the failed report and click **Retry**. It goes to Processing and
   then to Published, and shows attempt 1 (failed, timeout) and attempt 2 (succeeded).
5. **Idempotency (optional):** run `smoke.sh` to see a same-key replay return 200, and a same key with a different
   payload return 409.

Mock assessor keywords: `fire`/`smoke` → fire_smoke high/high (critical) · `accident` → road_hazard ·
`trash`/`garbage` → waste_pollution low · `pothole`/`dziura` → road_hazard medium · `broken`/`damage` →
infrastructure_damage · `mismatch`, `unclear`, `tie` → in_review · `flaky` fails once (then retry works) ·
`failtest` always fails · `fake` (with a photo) → manipulation "suspicious". A report with no photo and no
description goes straight to in_review (`no_evidence`).

Seeded receipt tokens are `seed-token-<key>`, for example `seed-token-pub-1`.

## Deviations from ERD v1

| ERD v1 | This build | Why |
|---|---|---|
| PostgreSQL (ENUMs, NUMERIC(5,2), uuid, timestamptz) | **SQLite** (WAL). Enums are CHECK constraints, confidence is REAL, uuid and timestamps are ISO TEXT. The 5 tables, §7 constraints (including composite FKs) and §10 indexes are kept | No Docker or Postgres on the build machine |
| Docker Compose with 2 Nginx containers (client-ui, operator-ui) | **One** Vite/React app: client at `/`, operator at `/operator/*`. Vite dev/preview proxies `/api` | Time budget. Same routes and proxy behaviour |
| Grouping serialized with a PG transactional lock | A process-wide Python lock around the grouping transaction; the model call runs outside it | Single process, SQLite |
| uploads volume | `backend/uploads/` folder | No Docker |
| Async processing | FastAPI `BackgroundTasks` in the API process, no queue. On restart, reports left in `processing` become `failed` (`interrupted`) and need a manual retry | Simplicity |
| OpenAI assessor | OpenAI `chat.completions.parse` with a strict schema. A deterministic **keyword mock** runs when `OPENAI_API_KEY` is empty | Offline demo. **The real OpenAI path has not been run end to end** |
| Operator auth (not specified) | One shared bearer token (`OPERATOR_TOKEN`, default `demo`); the photo endpoint also accepts `?token=` | Demo only |

Additive endpoint: `GET /api/health`. Errors use FastAPI's `{detail}` body (401, 403, 404, 409, 413, 422).

## Known gaps

- The real OpenAI call is untested, and smoke.sh expects mock results.
- If the client reloads after a lost submit response, it can't resend the same payload (the photo is kept in memory
  only). The report shows as "Not confirmed" in *My reports*.
- A `suspicious` manipulation result or an `inconclusive` photo/description match does not by itself send a report to review.
- Photos are never cleaned up. CORS is open, there is no rate limiting, and map tiles and fonts need internet.
- Geolocation needs HTTPS or localhost. Over a plain-http LAN address, tap the map to set the location instead.
