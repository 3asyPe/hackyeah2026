#!/usr/bin/env bash
# End-to-end smoke test against a running backend in replay or mock mode (no OPENAI_API_KEY). Its generated
# inputs never match a recorded sample, so replay falls back to the keyword mock.
# Usage: ./smoke.sh [base_url]   (default http://localhost:8000)
set -euo pipefail
BASE="${1:-http://localhost:8000}"
OP="${OPERATOR_TOKEN:-demo}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$DIR/.venv/bin/python"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
j() { "$PY" -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
uuid() { "$PY" -c "import uuid; print(uuid.uuid4())"; }

# The test photo carries EXIF with a device name and GPS position; the server must not keep them.
"$PY" -c "
from PIL import Image
ex = Image.Exif(); ex[0x0110] = 'SmokePhone'; ex.get_ifd(0x8825)[2] = (50.0, 3.0, 40.0)
Image.new('RGB', (32, 32), (220, 80, 20)).save('$TMP/tiny.jpg', 'JPEG', exif=ex)"
NOEXIF="from PIL import Image; import sys; im = Image.open(sys.argv[1]); sys.exit(len(im.getexif()) or b'SmokePhone' in open(sys.argv[1], 'rb').read())"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "== health"; curl -fsS "$BASE/api/health" | tee "$TMP/h.json"; echo
MODE="$(j "d.get('mode')" < "$TMP/h.json")"
case "$MODE" in replay|mock) ;; *) fail "expected assessor mode replay or mock, got $MODE";; esac

echo "== submit fire report with photo"
KEY="$(uuid)"; TOKEN="smoke-receipt-$(uuid)"
submit() {
  curl -sS -o "$TMP/sub.json" -w '%{http_code}' -X POST "$BASE/api/reports" \
    -F submission_key="$KEY" -F receipt_token="$TOKEN" -F description="big fire near the school" \
    -F latitude=50.0612 -F longitude=19.9380 -F incident_time="$NOW" -F "photo=@$TMP/tiny.jpg;type=image/jpeg"
}
CODE="$(submit)"; cat "$TMP/sub.json"; echo
[ "$CODE" = "202" ] || fail "expected 202, got $CODE"
RID="$(j "d['id']" < "$TMP/sub.json")"

echo "== idempotent replay (same key + payload -> 200 same id)"
CODE="$(submit)"; [ "$CODE" = "200" ] || fail "replay expected 200, got $CODE"
[ "$(j "d['id']" < "$TMP/sub.json")" = "$RID" ] || fail "replay returned another id"

echo "== conflicting replay (same key, other payload -> 409)"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/reports" -F submission_key="$KEY" \
  -F receipt_token="$TOKEN" -F description="something else" -F latitude=50.06 -F longitude=19.94 -F incident_time="$NOW")"
[ "$CODE" = "409" ] || fail "conflict expected 409, got $CODE"

echo "== bad receipt token -> 403"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H 'X-Receipt-Token: wrong-token-wrong-token' "$BASE/api/reports/$RID")"
[ "$CODE" = "403" ] || fail "expected 403, got $CODE"

echo "== poll status"
STATUS=processing
for _ in $(seq 1 30); do
  curl -fsS -H "X-Receipt-Token: $TOKEN" "$BASE/api/reports/$RID" > "$TMP/st.json"
  STATUS="$(j "d['status']" < "$TMP/st.json")"
  [ "$STATUS" != "processing" ] && break
  sleep 0.5
done
echo "status=$STATUS final=$(j "d['final']" < "$TMP/st.json")"
[ "$STATUS" = "critical" ] || fail "fire report expected critical, got $STATUS"
[ "$(j "'current_assessment' in d" < "$TMP/st.json")" = "False" ] || fail "public JSON leaks current_assessment"
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/reports/$RID" > "$TMP/op.json"
[ "$(j "d['current_assessment']['severity_confidence']['high']" < "$TMP/op.json")" != "None" ] || fail "no confidence"

echo "== public photo"
CODE="$(curl -sS -o "$TMP/stored.jpg" -w '%{http_code}' "$BASE/api/reports/$RID/photo?token=$TOKEN")"
[ "$CODE" = "200" ] || fail "photo expected 200, got $CODE"
"$PY" -c "$NOEXIF" "$TMP/stored.jpg" || fail "stored photo still has EXIF metadata"

echo "== accident report (published + simulation), then a second nearby one merges"
sub_simple() { # desc lat lon -> id (receipt token kept in $TMP/tok-<id>)
  local k t id; k="$(uuid)"; t="smoke-receipt-$(uuid)"
  id="$(curl -fsS -X POST "$BASE/api/reports" -F submission_key="$k" -F receipt_token="$t" -F description="$1" \
    -F latitude="$2" -F longitude="$3" -F incident_time="$NOW" | j "d['id']")"
  echo "$t" > "$TMP/tok-$id"; echo "$id"
}
A1="$(sub_simple "car accident on the roundabout" 50.0400 19.9000)"
sleep 2.5
A2="$(sub_simple "crash, two cars" 50.0401 19.9001)"
sleep 2.5
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/reports/$A1" > "$TMP/a1.json"
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/reports/$A2" > "$TMP/a2.json"
[ "$(j "d['status']" < "$TMP/a1.json")" = "published" ] || fail "accident not published: $(cat "$TMP/a1.json")"
[ "$(j "d['simulation'] is not None" < "$TMP/a1.json")" = "True" ] || fail "no simulation for high severity"
[ "$(j "d['incident_id']" < "$TMP/a1.json")" = "$(j "d['incident_id']" < "$TMP/a2.json")" ] || fail "not grouped"
INC="$(j "d['incident_id']" < "$TMP/a1.json")"

echo "== map"
curl -fsS "$BASE/api/incidents" > "$TMP/map.json"
echo "markers: $(j "len(d)" < "$TMP/map.json")"
[ "$(j "[m['published_count'] for m in d if m['id']=='$INC'][0]" < "$TMP/map.json")" = "2" ] || fail "map count"
curl -fsS "$BASE/api/incidents/$INC" > "$TMP/inc.json"
j "(d['category'], d['max_severity'], len(d['reports']))" < "$TMP/inc.json"
[ "$(j "any('description' in r for r in d['reports'])" < "$TMP/inc.json")" = "False" ] || fail "public card exposes descriptions"

echo "== operator auth"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/operator/summary")"
[ "$CODE" = "401" ] || fail "expected 401, got $CODE"
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/summary"; echo
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/incidents?state=active" | j "len(d)"
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/incidents/$INC" | j "(d['report_count'], d['published_count'])"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/operator/reports/$RID/photo?token=$OP")"
[ "$CODE" = "200" ] || fail "operator photo expected 200, got $CODE"

echo "== no-evidence report -> in_review, then approve"
K="$(uuid)"
curl -fsS -X POST "$BASE/api/reports" -F submission_key="$K" -F receipt_token="smoke-receipt-$(uuid)" \
  -F latitude=50.0300 -F longitude=19.9700 -F incident_time="$NOW" > "$TMP/nr.json"
[ "$(j "d['status']" < "$TMP/nr.json")" = "in_review" ] || fail "no-evidence not in_review"
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/reports?status=in_review" > "$TMP/q.json"
REV="$(j "d[0]['id']" < "$TMP/q.json")"
echo "approving $REV ($(j "d[0]['review_reason']" < "$TMP/q.json"))"
curl -fsS -X POST -H "Authorization: Bearer $OP" -H 'Content-Type: application/json' \
  -d '{"action":"approve","final_category":"road_hazard","final_severity":"high","final_urgency":"low","operator_label":"smoke-operator","comment":"verified"}' \
  "$BASE/api/operator/reports/$REV/review" > "$TMP/rv.json"
[ "$(j "d['status']" < "$TMP/rv.json")" = "published" ] || fail "approve did not publish: $(cat "$TMP/rv.json")"
[ "$(j "d['final']['source']" < "$TMP/rv.json")" = "operator" ] || fail "final source not operator"
[ "$(j "len(d['reviews'])" < "$TMP/rv.json")" = "1" ] || fail "review not recorded"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $OP" -H 'Content-Type: application/json' \
  -d '{"action":"approve","final_category":"road_hazard","final_severity":"high","final_urgency":"low","operator_label":"x"}' "$BASE/api/operator/reports/$REV/review")"
[ "$CODE" = "409" ] || fail "second review expected 409, got $CODE"

echo "== flaky report -> failed, retry -> processed"
K="$(uuid)"
FID="$(curl -fsS -X POST "$BASE/api/reports" -F submission_key="$K" -F receipt_token="smoke-receipt-$(uuid)" \
  -F description="flaky trash pile" -F latitude=50.0200 -F longitude=19.9100 -F incident_time="$NOW" | j "d['id']")"
sleep 2.5
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/reports/$FID" | j "d['status']" | grep -qx failed || fail "flaky not failed"
curl -fsS -X POST -H "Authorization: Bearer $OP" "$BASE/api/operator/reports/$FID/retry" | j "d['status']" | grep -qx processing || fail "retry not processing"
sleep 2.5
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/reports/$FID" > "$TMP/f.json"
[ "$(j "d['status']" < "$TMP/f.json")" = "published" ] || fail "retry not published: $(j "d['status']" < "$TMP/f.json")"
[ "$(j "len(d['assessments'])" < "$TMP/f.json")" = "2" ] || fail "expected 2 attempts"

echo "== privacy info"
curl -fsS "$BASE/api/privacy" | tee "$TMP/pv.json"; echo
[ "$(j "d['retention_days'] > 0" < "$TMP/pv.json")" = "True" ] || fail "retention not configured"

echo "== reporter deletes their report (bad token -> 403, processing -> 409, then 204 and gone)"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H 'X-Receipt-Token: wrong-token-wrong-token' "$BASE/api/reports/$RID")"
[ "$CODE" = "403" ] || fail "delete with bad token expected 403, got $CODE"
K="$(uuid)"; T="smoke-receipt-$(uuid)"
PID="$(curl -fsS -X POST "$BASE/api/reports" -F submission_key="$K" -F receipt_token="$T" -F description="trash pile" \
  -F latitude=50.0100 -F longitude=19.8800 -F incident_time="$NOW" | j "d['id']")"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "X-Receipt-Token: $T" "$BASE/api/reports/$PID")"
[ "$CODE" = "409" ] || fail "delete while processing expected 409, got $CODE"
sleep 2.5
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "X-Receipt-Token: $T" "$BASE/api/reports/$PID")"
[ "$CODE" = "204" ] || fail "delete of a published report expected 204, got $CODE"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "X-Receipt-Token: $TOKEN" "$BASE/api/reports/$RID")"
[ "$CODE" = "204" ] || fail "delete of a critical report expected 204, got $CODE"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Receipt-Token: $TOKEN" "$BASE/api/reports/$RID")"
[ "$CODE" = "404" ] || fail "deleted report expected 404, got $CODE"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $OP" "$BASE/api/operator/reports/$RID")"
[ "$CODE" = "404" ] || fail "deleted report still visible to the operator ($CODE)"

echo "== deleting one of two grouped reports keeps the incident, deleting both removes it and its merged stub"
del_own() { curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "X-Receipt-Token: $(cat "$TMP/tok-$1")" "$BASE/api/reports/$1"; }
[ "$(del_own "$A2")" = "204" ] || fail "delete A2"
[ "$(curl -fsS "$BASE/api/incidents/$INC" | j "d['published_count']")" = "1" ] || fail "incident count after deleting A2"
[ "$(del_own "$A1")" = "204" ] || fail "delete A1"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $OP" "$BASE/api/operator/incidents/$INC")"
[ "$CODE" = "404" ] || fail "empty incident still exists ($CODE)"
curl -fsS -H "Authorization: Bearer $OP" "$BASE/api/operator/incidents?state=merged" > "$TMP/mg.json"
[ "$(j "sum(1 for i in d if i['merged_into_id'] == '$INC')" < "$TMP/mg.json")" = "0" ] || fail "merged stub left behind"
echo "ALL SMOKE CHECKS PASSED"
