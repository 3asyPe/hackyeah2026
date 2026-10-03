# Privacy (GDPR basics)

What this prototype does about personal data, and what it does not do yet. This is not legal advice.

## Record of processing (Art. 30)

| | |
|---|---|
| **Controller** | The team running the prototype. Set the contact in `frontend/src/client/PrivacyPage.tsx` (`CONTROLLER`) |
| **Purpose** | Assess reported local incidents, group nearby reports, show them on a public map, alert an operator to urgent ones |
| **Legal basis** | Public interest (Art. 6(1)(e)) when run for a city or emergency service; otherwise legitimate interest (Art. 6(1)(f)) |
| **Data subjects** | People who send a report; people who appear in a photo or are named in a description |
| **Personal data** | Photo, free-text description, location and time of the incident, IP address in server logs. No accounts, names or emails |
| **Recipients** | Operators (full report); OpenAI as processor (photo, description, exact location, time) when `ASSESSOR=openai`, and with `ASSESSOR=replay_first` for every report that is not a bundled sample with a recorded replay (`replay` and `mock` call no AI provider); the public (category, levels, time, report count, incident position) |
| **Transfers outside the EEA** | OpenAI, USA. Needs OpenAI's DPA (with SCCs) before a real deployment |
| **Retention** | Deleted 30 days after the last change, rejected reports after 7 (`RETENTION_DAYS`, `REJECTED_RETENTION_DAYS`) |
| **Security** | Photos are served only to the operator or the holder of the receipt token; the receipt token is stored hashed. See the gaps below |

## What the code does

- **Photo metadata is removed on upload** (`backend/app/privacy.py`). A photo that carries EXIF (GPS position,
  device, capture time), XMP, IPTC or comments is re-encoded without it, keeping the visual orientation. A photo with
  no metadata is stored byte for byte, so the bundled samples still match their replay fixtures. The model receives
  the cleaned file.
- **The public map shows no descriptions or photos.** `GET /api/incidents/{id}` returns only times and levels per report.
- **Reporters can delete their report.** The status page has a *Delete report* button
  (`DELETE /api/reports/{id}` with the receipt token). It erases the report, photo, assessments, operator reviews and
  simulation, plus any incident row left without reports. The copy kept in the browser is removed too. The status
  page shows the reporter the details they sent and the report's status (right of access); it deliberately hides the
  model assessment, review reason and operator reviews. Deleting is refused (409) while the report is still
  `processing`.
- **Retention.** The API purges expired reports at startup and then every hour. Reports in `processing` are skipped.
- **Notice.** The report form tells people to avoid faces, licence plates and names and links to `/privacy`, which
  reads the retention periods and assessor mode from `GET /api/privacy`.

## Not done yet

- A DPA with OpenAI, and zero data retention or EU data residency on the OpenAI project.
- Per-operator accounts instead of the shared `OPERATOR_TOKEN`, an access log of who opened which photo, and HTTPS.
- Blurring faces and licence plates in photos.
- Rounding the incident position on the public map. It is currently the first reporter's exact point, and it stays on
  the map as the incident's anchor while other reports remain in the incident, even after the first reporter deletes
  their report.
- Log retention: uvicorn access logs contain IP addresses and are kept as long as whoever runs the server keeps them.
- A DPIA. Likely needed for a real deployment because of photos of the public and AI-based assessment.
