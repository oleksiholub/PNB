export const EXPECTED_GCP_REGION = "us-east1";

export function assertExpectedRegion(configuredRegion: string | undefined): void {
  if (!configuredRegion) {
    throw new Error(
      "GCP_REGION is not set. Per TZ section 3.2, region must be explicitly us-east1."
    );
  }
  if (configuredRegion !== EXPECTED_GCP_REGION) {
    throw new Error(
      `GCP_REGION mismatch: expected "${EXPECTED_GCP_REGION}", got "${configuredRegion}". ` +
      "Deploying outside us-east1 may violate the Always Free budget assumptions in TZ section 1."
    );
  }
}