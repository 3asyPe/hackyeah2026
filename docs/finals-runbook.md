# Finals runbook

1. Stop the backend, then run `.venv/bin/python -m app.reset_demo --yes` (from `backend/`) at most 5 minutes before going on stage.
2. Start `uvicorn app.main:app` **without** `--reload`, with `ASSESSOR=replay_first` and a strong `OPERATOR_TOKEN`.
3. Check `/api/health` (expect `mode: replay_first` and the recorded sample count).
4. Dry-run the sample fire (expect `critical`), then stop the backend and reset again.
5. Use a phone hotspot instead of venue Wi-Fi.
6. Keep `docs/demo.webm` cued as the fallback.
7. Sections for the trace and storm demos will be added later.
