# Stage reliability: implementation plan

Branch: `stage-reliability`, cut from `replay-assessor`. This plan has no separate spec. The authority is the short design the user approved in session on 2026-10-03, summarised under Global Constraints.

**Goal:** make the live finals demo robust to phone and network problems, and fix the two deferred citizen-page issues.

## Global Constraints

- **Leave `AssessmentOutput` and the replay `fixture_key` alone** (`backend/app/assessor.py`).
- **Replay and mock demo modes must keep working.**
  - `backend/smoke.sh` must pass against a backend started in replay mode with a temporary `DATA_DIR`/`UPLOAD_DIR`.
  - Never touch `backend/data` or `backend/uploads`.
- **Backend tests:** run `.venv/bin/python -m pytest -q` from `backend/`. They use `backend/tests/conftest.py` (tmp dirs, `ASSESSOR=mock`, `MOCK_DELAY_S=0`, pinned limits).
- **Frontend checks:** from `frontend/`, `npx tsc -b`, `npm run build` and `npm run lint` must pass. Lint has 11 pre-existing warnings, and this work must add no new ones.
- **New npm dependencies are pinned to exact versions:**
  - `@vitejs/plugin-basic-ssl` 2.3.0 (dev)
  - `qrcode` 1.5.4
  - `@types/qrcode` 1.5.6 (dev)

  Install with `npm install --save-exact`.
- **Do not prefetch or bundle OpenStreetMap tiles.** The OSM tile usage policy forbids bulk downloading.
- **Status values are unchanged.**
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Match the surrounding code style.** Compact code, sparse comments, existing CSS classes and tokens in `frontend/src/index.css`.

---

## Task 1: The citizen status page follows live changes and only links to the map when the incident is on it

**Files:** `backend/app/views.py`, `backend/app/main.py`, `frontend/src/api.ts`, `frontend/src/client/StatusPage.tsx`, `backend/tests/test_views.py`.

### Backend

- **Move the map-visibility rule into `views.py`** so the map endpoints and the report view share it:
  - Move `_on_map(pub_rows)` from `main.py` to `views.py` as `on_map(pub_rows) -> bool`, with the same body (latest published `incident_time` ≥ now − `config.MAP_MAX_AGE_H` hours).
  - `views.py` imports `config` and `datetime` as needed.
  - Update the two call sites in `main.py` to use `views.on_map`.
- **Add `on_map` to the public report JSON.** `views.report_public` adds `"on_map": bool` for **both** public and operator JSON. It is `True` only when all of these hold:
  - the report's status is `published`;
  - its incident's `state` is `active`;
  - `views.on_map(<all published reports of that incident>)` is true. Use the same `REPORT_SELECT ... WHERE r.status='published' AND r.incident_id=?` rows that `get_incident_public` uses.

  Otherwise it is `False`, so `critical`, `in_review` and every other status give `False`.

### Frontend

- **`api.ts`:** `ReportPublic` gains `on_map: boolean`.
- **`StatusPage.tsx` polling.** `intervalFor` keeps polling at **10000 ms** when the status is `published` or `critical`, so a live retraction or an operator decision shows without a reload. `rejected` stays `null` (stop). `processing`, `in_review` and `failed` are unchanged.
- **`StatusPage.tsx` map link and banner.**
  - The "View incident on map →" button renders only when `report.on_map` is true.
  - The published banner's line reads "Your report is linked to an incident on the public map." only when `on_map` is true.
  - Otherwise it reads "Your report is published. Its incident is older than 24 hours, so it is no longer shown on the live map."

### Tests (`test_views.py`, TDD)

- A freshly published report has `on_map` True in both the public and the operator JSON.
- A published report whose `incident_time` is 30 h ago has `on_map` False.
- A critical report (mock description containing "fire") has `on_map` False.
- After an operator rejects (retracts) a published report, its public JSON has `on_map` False.

---

## Task 2: HTTPS dev server for phones, and an offline map fallback

**Files:** `frontend/package.json` (plus the lockfile), `frontend/vite.config.ts`, new `frontend/src/components/useTileStatus.ts` (or similar), `frontend/src/client/MapPage.tsx`, `frontend/src/client/SubmitPage.tsx`, `frontend/src/index.css`.

### HTTPS

- Add `@vitejs/plugin-basic-ssl` 2.3.0 as an exact dev dependency.
- `vite.config.ts` adds `basicSsl()` to `plugins` **only** when `process.env.HTTPS === '1'`.
- New script: `"dev:https": "HTTPS=1 vite"`.
- Plain `npm run dev` must stay plain HTTP and otherwise unchanged. Keep the existing `server.host: true` and the `/api` proxy.

### Offline tile fallback

- When OSM tiles fail to load, both maps (`MapPage`, and `SubmitPage`'s location picker) switch to an offline look, and markers, clicks and location picking keep working.
- Implementation:
  - A small shared hook or component tracks tile errors from the `TileLayer`'s `eventHandlers` (`tileerror`, `tileload`).
  - After **3** tile errors with no successful `tileload` since, it sets `offline = true`. A later `tileload` resets it to false.
  - While offline, the map container gets a CSS class (for example `map-offline`) that shows a subtle grid background, using CSS only and existing colour tokens. Broken-tile images are hidden (`.map-offline .leaflet-tile { visibility: hidden }`).
  - A small overlay notice is pinned top-centre inside the map: "Map tiles offline. Markers and positions are still accurate."
- No new dependencies for this part.

### Verification

- `npx tsc -b`, `npm run build` and `npm run lint` (no new warnings).
- Start `npm run dev:https` briefly and confirm that it serves `https://localhost:5173` with `curl -k -I`. Then stop it.
- Describe in the report how the offline state was exercised. For example, temporarily point `OSM_URL` at an unreachable host in a scratch run, without committing that change, or reason through the event wiring if a browser is not available.

---

## Task 3: "Report from your phone" QR card on the operator overview, plus runbook and README

**Files:** `frontend/package.json` (plus the lockfile), new `frontend/src/operator/PhoneQrCard.tsx`, `frontend/src/operator/OverviewPage.tsx`, `frontend/src/index.css`, `docs/finals-runbook.md`, `README.md`.

### Dependencies

Add `qrcode` 1.5.4 and `@types/qrcode` 1.5.6 (dev), both exact.

### `PhoneQrCard`

- A card on the operator overview, below the counters, titled "Report from your phone".
- It renders a QR code (generated with `QRCode.toDataURL` in an effect, shown as `<img>` about 160 px, alt "QR code for the reporting page") that encodes `window.location.origin + '/'` (the citizen app root).
- The URL is shown as text under the QR code.
- If `window.location.hostname` is `localhost` or `127.0.0.1`, or ends with `.local`, show a hint instead of relying on the QR code: "Phones cannot reach localhost. Open this page via the laptop's network address (for example https://192.168.x.x:5173, started with npm run dev:https) and the QR code will point there." The QR code is still rendered.
- The card must not break the overview if QR generation fails. Catch the error and show only the URL.

### `docs/finals-runbook.md`

Add a short "Phone on stage" section:
1. Put the laptop on the phone's hotspot.
2. Start the frontend with `npm run dev:https`.
3. Open `/operator` on the laptop via `https://<laptop-ip>:5173`.
4. Scan the QR code from the overview with the phone.
5. Accept the self-signed certificate warning once.
6. "Use my location" now works. The fallback is tapping the map.
7. If map tiles fail, the maps switch to the offline grid and markers stay correct.

### `README.md`

One line under Run → Frontend: "`npm run dev:https` serves over HTTPS (self-signed) so phones on the LAN can use geolocation."

### Verification

`npx tsc -b`, `npm run build`, `npm run lint` (no new warnings).
