#!/usr/bin/env bash
# PNB Cloud Build trigger provisioning (Sub-step G.1).
#
# TZ section 5 bootstrap step 10: "Настроен Cloud Build trigger и merge
# automation policy." This script provisions ONLY the trigger half (runs
# cloudbuild.yaml on push to auto/*); merge automation policy itself is
# Sub-step G.2 and is NOT configured by this script.
#
# All identifiers below are placeholders (REPLACE_ME_*), consistent with
# the Hardcoding Check requirement - no project-specific values are
# baked in. This script is meant to be run once per environment by
# whoever owns deployment (see TZ section 5 bootstrap step 2: "billing
# account присвоен").
#
# PRECONDITION: a GitHub App connection between this GCP project and the
# target repository must already exist (TZ section 5 bootstrap step 7),
# since --repository below refers to a Cloud Build 2nd-gen repository
# connection, not a raw GitHub URL.

set -euo pipefail

PROJECT_ID="REPLACE_ME_GCP_PROJECT_ID"
REGION="us-east1"  # mandatory per TZ section 1/3.2/6
REPOSITORY_CONNECTION="REPLACE_ME_CLOUD_BUILD_REPO_CONNECTION_NAME"
BACKEND_SERVICE_URL="REPLACE_ME_CLOUD_RUN_SERVICE_URL"

gcloud builds triggers create github \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --name="pnb-auto-branch-ci" \
  --repository="${REPOSITORY_CONNECTION}" \
  --branch-pattern="^auto/.*$" \
  --build-config="cloudbuild.yaml" \
  --substitutions="_BACKEND_SERVICE_URL=${BACKEND_SERVICE_URL}"

echo "Trigger 'pnb-auto-branch-ci' created for branch pattern ^auto/.*$ in ${REGION}."
echo "NOTE: merge-on-green-CI automation (Sub-step G.2) is NOT configured by this script."