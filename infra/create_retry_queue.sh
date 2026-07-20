#!/usr/bin/env bash
# PNB Cloud Tasks retry queue provisioning (Sub-step H.1).
#
# TZ section 3.4: retries must use exponential backoff before falling
# through to dead_letter. Exponential backoff parameters
# (min-backoff/max-backoff/max-doublings/max-attempts) are configured at
# the QUEUE level here, verified via web search against
# docs.cloud.google.com/tasks/docs/configuring-queues and multiple
# independent Cloud Tasks retry-policy references - this is the
# authoritative place these values live, NOT in application code (see
# retryQueueService.ts header).
#
# Values below are illustrative defaults, not mandated by the TZ (which
# does not specify exact backoff numbers) - they follow the commonly
# documented "1s min, exponential up to 10 min max, 5 attempts, bounded
# by a 1 hour total retry duration" pattern seen across the verified
# sources, and should be tuned per real traffic once Iteration I
# acceptance testing has real failure-rate data.

set -euo pipefail

PROJECT_ID="REPLACE_ME_GCP_PROJECT_ID"
LOCATION="us-east1"  # mandatory per TZ section 1/3.2/6
QUEUE_NAME="pnb-retry-queue"

gcloud tasks queues create "${QUEUE_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --max-attempts=5 \
  --min-backoff=1s \
  --max-backoff=600s \
  --max-doublings=5 \
  --max-retry-duration=3600s

echo "Queue '${QUEUE_NAME}' created in ${LOCATION} with max-attempts=5, min-backoff=1s, max-backoff=600s."
echo "NOTE: dispatching business-logic retries into this queue from existing failure paths (capture, summarization) is an explicit H.1 follow-up, not yet wired - see retryQueueService.ts INTEGRATION DISCLOSURE."