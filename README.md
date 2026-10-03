# Incident Reporter

People report an incident from their phone: a photo, an optional description, a location and a time. An LLM
classifies it by category, severity and urgency and checks that the photo matches the description. The backend then
routes the report:

- **published**: grouped with nearby similar reports and shown on the public map
- **critical** (high severity and high urgency): goes to the operator queue as a simulated 112 escalation
- **in_review**: held for an operator when the photo and description don't match or the model is unsure
- **failed**: the model call failed; an operator can retry it

Stack: FastAPI + SQLite, React (Vite), OpenAI. The data model is in [docs/erd-v1.md](docs/erd-v1.md) and the API
in [docs/PLAN.md](docs/PLAN.md).

## Run

Backend (port 8000):

```bash
cd backend
cp .env.example .env          # set OPENAI_API_KEY; leave it empty to replay recorded assessments
uv venv && uv pip install -r requirements.txt
.venv/bin/python -m app.seed  # demo data
.venv/bin/uvicorn app.main:app --port 8000 --reload
```

Frontend (port 5173):

```bash
cd frontend
npm install && npm run dev
```

- Client: http://localhost:5173
- Operator: http://localhost:5173/operator (token `demo`)

## Demo without an API key

With no `OPENAI_API_KEY` the backend runs in **replay** mode. The bundled samples in `backend/samples/` come with real
model outputs recorded in `backend/fixtures/replay/`, so submitting a sample unchanged shows a real assessment. Any
other report goes to a keyword mock, and its explanation says so. `assessment.model` shows which one ran
(`replay:<model>` or `mock`), and `GET /api/health` reports the mode.

To try it, open the client, pick a card under **Try a sample** on the Report page and submit. The badge at the top shows
which assessor is active. Sample photos are from Wikimedia Commons; the credits are in `backend/samples/samples.json`.

`ASSESSOR` in `.env` picks the mode: `auto` (default: `openai` with a key, otherwise `replay`), `openai`, `replay`, `replay_first`
(samples replay, anything else goes to OpenAI; needs a key, falls back to the mock on a network failure) or `mock`. Reset before a demo: `.venv/bin/python -m app.reset_demo --yes` (backend stopped). To re-record the samples with a key, run `.venv/bin/python -m app.record_fixtures [--only id,id] [--force]`.

The mock picks the outcome from keywords in the description:

- `fire` → critical
- `trash` → published
- `mismatch` → in_review
- `flaky` → fails once, so you can show a retry
