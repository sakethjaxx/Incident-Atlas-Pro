#!/usr/bin/env bash
set -e

API_URL="http://localhost:3001"
TEST_FILE="test-incident.txt"

echo "==> Checking if API is reachable..."
if ! curl -s "$API_URL/health" > /dev/null; then
  echo "Booting stack (Docker)..."
  docker compose up -d --wait || true
  # Note: if local running outside docker, please ensure 'pnpm run dev' is active.
fi

echo "==> Creating test payload..."
cat << 'EOF' > "$TEST_FILE"
# Incident Postmortem
We had a major system outage yesterday.
## Root Cause
The database connection pool was exhausted.
## Mitigation
We increased the pool size and added monitoring.
EOF

echo "==> Uploading test file..."
UPLOAD_RESP=$(curl -s -X POST "$API_URL/ingest/upload" -F "file=@$TEST_FILE")
echo "$UPLOAD_RESP" | jq . || echo "$UPLOAD_RESP"

JOB_ID=$(echo "$UPLOAD_RESP" | jq -r '.jobId')
if [ "$JOB_ID" = "null" ] || [ -z "$JOB_ID" ]; then
  echo "Failed to get jobId"
  exit 1
fi

echo "==> Job enqueued with ID: $JOB_ID"
echo "==> Polling job status..."

MAX_RETRIES=15
COUNTER=0
INCIDENT_ID="null"

while [ $COUNTER -lt $MAX_RETRIES ]; do
  STATUS_RESP=$(curl -s "$API_URL/jobs/$JOB_ID")
  STATUS=$(echo "$STATUS_RESP" | jq -r '.status')
  
  echo "Status: $STATUS"
  
  if [ "$STATUS" = "completed" ]; then
    INCIDENT_ID=$(echo "$STATUS_RESP" | jq -r '.result.incidentId // .result')
    # fallback for nested result:
    if [ "$INCIDENT_ID" = "null" ]; then
        INCIDENT_ID=$(echo "$STATUS_RESP" | jq -r '.incidentId')
    fi
    echo "Job successfully completed!"
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "Job failed processing!"
    echo "$STATUS_RESP" | jq .
    exit 1
  fi
  
  sleep 2
  let COUNTER=COUNTER+1
done

if [ "$INCIDENT_ID" = "null" ]; then
  echo "Failed to retrieve incidentId before timeout."
  exit 1
fi

echo "==> Fetching processed incident (ID: $INCIDENT_ID)..."
curl -s "$API_URL/incidents/$INCIDENT_ID" | jq .

echo "==> Sprint 1 Smoke Test SUCCESS! Exiting 0."
rm -f "$TEST_FILE"
exit 0
