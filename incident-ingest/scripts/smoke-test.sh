#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
MAX_RETRIES="${MAX_RETRIES:-20}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-2}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/incident-atlas-smoke.XXXXXX")"
RESP_FILE="$TMP_DIR/response.json"
TEST_FILE_A="$TMP_DIR/incident-a.txt"
TEST_FILE_B="$TMP_DIR/incident-b.txt"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

AUTH_ARGS=()
if [ -n "$ADMIN_TOKEN" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer $ADMIN_TOKEN")
else
  echo "WARN: ADMIN_TOKEN is not set; upload checks will only work if the API allows unauthenticated admin routes." >&2
fi

request_json() {
  local status
  status=$(curl -sS -o "$RESP_FILE" -w "%{http_code}" "$@")
  if (( status < 200 || status >= 300 )); then
    echo "Request failed with HTTP $status" >&2
    cat "$RESP_FILE" >&2
    echo >&2
    return 1
  fi
  cat "$RESP_FILE"
}

wait_for_incident() {
  local job_id="$1"
  local counter=0
  local status_resp
  local status
  local incident_id

  echo "==> Polling job status for $job_id..." >&2

  while [ "$counter" -lt "$MAX_RETRIES" ]; do
    status_resp=$(request_json "$API_URL/jobs/$job_id")
    status=$(echo "$status_resp" | jq -r '.status')

    echo "Status: $status" >&2

    if [ "$status" = "completed" ] || [ "$status" = "success" ]; then
      incident_id=$(echo "$status_resp" | jq -r '.result.incidentId // .result // .incidentId // empty')
      if [ -z "$incident_id" ] || [ "$incident_id" = "null" ]; then
        echo "Completed job did not return an incidentId" >&2
        echo "$status_resp" | jq . >&2
        return 1
      fi
      echo "$incident_id"
      return 0
    fi

    if [ "$status" = "failed" ]; then
      echo "Job failed processing:" >&2
      echo "$status_resp" | jq . >&2
      return 1
    fi

    sleep "$POLL_INTERVAL_SECONDS"
    counter=$((counter + 1))
  done

  echo "Timed out waiting for job $job_id to complete." >&2
  return 1
}

upload_file() {
  local file_path="$1"
  local upload_resp
  local job_id

  echo "==> Uploading $(basename "$file_path")..." >&2
  upload_resp=$(request_json -X POST "${AUTH_ARGS[@]}" "$API_URL/ingest/upload" -F "file=@$file_path;type=text/plain")
  echo "$upload_resp" | jq . >&2

  job_id=$(echo "$upload_resp" | jq -r '.jobId // empty')
  if [ -z "$job_id" ] || [ "$job_id" = "null" ]; then
    echo "Upload response did not include jobId" >&2
    return 1
  fi

  echo "$job_id"
}

echo "==> Checking if API is reachable..."
if ! curl -fsS "$API_URL/health" > /dev/null; then
  echo "Booting stack (Docker)..."
  if command -v docker >/dev/null 2>&1; then
    docker compose up -d --wait || true
  else
    echo "Docker is not available and $API_URL/health is unreachable." >&2
    exit 1
  fi

  if ! curl -fsS "$API_URL/health" > /dev/null; then
    echo "API is still unreachable after Docker startup." >&2
    echo "Start the API server separately or point API_URL at a deployed environment before rerunning the smoke test." >&2
    exit 1
  fi
fi

echo "==> Creating test payloads..."
cat << 'EOF' > "$TEST_FILE_A"
# Incident Postmortem
We had a major system outage yesterday.
## Root Cause
The database connection pool was exhausted after a bad deploy.
## Mitigation
We increased the pool size, rolled back the release, and added monitoring.
EOF

cat << 'EOF' > "$TEST_FILE_B"
# Incident Report
Customer traffic failed for several minutes after deployment.
## Root Cause
The deploy caused database pool saturation and request timeouts.
## Mitigation
We rolled back, tuned the connection pool, and added deployment guards.
EOF

JOB_ID_A=$(upload_file "$TEST_FILE_A")
INCIDENT_ID_A=$(wait_for_incident "$JOB_ID_A")
echo "==> First incident processed: $INCIDENT_ID_A"

JOB_ID_B=$(upload_file "$TEST_FILE_B")
INCIDENT_ID_B=$(wait_for_incident "$JOB_ID_B")
echo "==> Second incident processed: $INCIDENT_ID_B"

echo "==> Fetching processed incident (ID: $INCIDENT_ID_A)..."
request_json "$API_URL/incidents/$INCIDENT_ID_A" | jq .

echo "==> Testing Search API..."
SEARCH_RESP=$(request_json --get --data-urlencode "q=pool" "$API_URL/search")
echo "$SEARCH_RESP" | jq .
RESULTS_COUNT=$(echo "$SEARCH_RESP" | jq '.results | length')
MATCHED_INCIDENTS=$(echo "$SEARCH_RESP" | jq --arg a "$INCIDENT_ID_A" --arg b "$INCIDENT_ID_B" '[.results[] | select(.incident.id == $a or .incident.id == $b)] | length')
if [ "$RESULTS_COUNT" -lt 1 ] || [ "$MATCHED_INCIDENTS" -lt 1 ]; then
  echo "Search did not return the expected smoke-test incidents." >&2
  exit 1
fi
echo "Search verified successfully with $RESULTS_COUNT results."

echo "==> Testing Similar Incidents API..."
SIMILAR_RESP=$(request_json "$API_URL/incidents/$INCIDENT_ID_A/similar")
echo "$SIMILAR_RESP" | jq .
SIMILAR_COUNT=$(echo "$SIMILAR_RESP" | jq '.similar | length')
MATCHED_SIMILAR=$(echo "$SIMILAR_RESP" | jq --arg id "$INCIDENT_ID_B" '[.similar[] | select(.incident.id == $id)] | length')
if [ "$SIMILAR_COUNT" -lt 1 ] || [ "$MATCHED_SIMILAR" -lt 1 ]; then
  echo "Similar incidents did not return the related smoke-test incident." >&2
  exit 1
fi

echo "==> Sprint 2 Smoke Test SUCCESS! Exiting 0."
