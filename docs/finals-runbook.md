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

## Phone on stage

1. Put the laptop on the phone's hotspot.
2. Start the frontend with `npm run dev:https`.
3. Open `/operator` on the laptop via `https://<laptop-ip>:5173`.
4. Scan the QR code from the overview with the phone.
5. Accept the self-signed certificate warning once.
6. "Use my location" now works. The fallback is tapping the map.
7. If map tiles fail, the maps switch to the offline grid and markers stay correct.
