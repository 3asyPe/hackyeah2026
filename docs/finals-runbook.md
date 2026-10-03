# Finals runbook

1. Stop the backend, then run `.venv/bin/python -m app.reset_demo --yes` (from `backend/`) at most 5 minutes before going on stage.
2. Start `uvicorn app.main:app` **without** `--reload`, with `ASSESSOR=replay_first` and a strong `OPERATOR_TOKEN`.
   If you change `OPERATOR_TOKEN`, log in to `/operator` again with the new token (the browser's localStorage still holds the old one).
3. Start the frontend: `cd frontend && npm install && npm run dev`.
4. Check `/api/health` (expect `mode: replay_first` and the recorded sample count).
5. Dry-run the sample fire (expect `critical`). Also submit one non-sample report in `replay_first` and check its latency against `REPLAY_FIRST_TIMEOUT_S`. Then stop the backend and reset again.
6. After the last code change, run `backend/smoke.sh` against a temporary replay backend (own `DATA_DIR`/`UPLOAD_DIR`, `ASSESSOR=replay`).
7. Use a phone hotspot instead of venue Wi-Fi.
8. Keep `docs/demo.webm` cued as the fallback.
9. Ctrl+C on the backend may wait for in-flight assessments to finish.
10. Sections for the trace and storm demos will be added later.
