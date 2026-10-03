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
cp .env.example .env          # set OPENAI_API_KEY; leave it empty to use the mock assessor
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

The mock assessor picks the outcome from keywords in the description:

- `fire` → critical
- `trash` → published
- `mismatch` → in_review
- `flaky` → fails once, so you can show a retry
