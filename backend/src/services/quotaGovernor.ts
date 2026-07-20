/**
 * Firestore quota governor (Sub-step H.3).
 *
 * TZ 3.4 requirement this file implements:
 *   "Если Firestore квоты чтения/записи приближаются к порогу, система
 *   должна: включить более агрессивную суммаризацию, временно
 *   сократить частоту фоновых обновлений, объединять несколько
 *   capture-событий в батч, при достижении жёсткого порога переводить
 *   не-критичные операции в deferred mode."
 *
 * HONEST LIMITATION DISCLOSURE (Established, by construction - not a
 * bug, a fundamental constraint of the chosen architecture): this
 * governor tracks Firestore write operations in an IN-MEMORY sliding
 * window PER Cloud Run INSTANCE. TZ 3.2 mandates the backend be
 * "stateless, scale-to-zero" with horizontal scaling under load, which
 * means:
 *   - Multiple concurrent Cloud Run instances each keep an independent,
 *     uncoordinated counter - there is no shared, authoritative,
 *     project-wide view of real Firestore quota consumption here.
 *   - An instance that scales to zero loses its counter entirely on the
 *     next cold start.
 * A fully correct implementation would need to read actual quota/usage
 * data from the Cloud Monitoring Metrics API (or Firestore's own usage
 * dashboards) server-side, which is explicitly OUT OF SCOPE for this
 * sub-step and is recorded as an open compromise in README.md. What
 * this governor DOES provide, honestly: a best-effort, per-instance
 * approximation of RECENT write pressure, sufficient to trigger the
 * qualitative behavior changes TZ 3.4 asks for (more aggressive
 * compression, reduced background-update frequency, batching,
 * deferred mode) as a defensive heuristic - not as a precise quota
 * accounting system.
 */
import { loadEnv } from "../config/env";

export type QuotaMode = "normal" | "aggressive" | "deferred";

interface QuotaGovernorConfig {
  windowMs: number;
  aggressiveThresholdOps: number;
  deferredThresholdOps: number;
}

export class QuotaGovernor {
  private writeTimestamps: number[] = [];

  constructor(private readonly config: QuotaGovernorConfig) {}

  recordWrite(): void {
    const now = Date.now();
    this.writeTimestamps.push(now);
    this.prune(now);
  }

  private prune(now: number): void {
    const cutoff = now - this.config.windowMs;
    while (
      this.writeTimestamps.length > 0 &&
      this.writeTimestamps[0] < cutoff
    ) {
      this.writeTimestamps.shift();
    }
  }

  getRecentWriteCount(): number {
    this.prune(Date.now());
    return this.writeTimestamps.length;
  }

  getQuotaMode(): QuotaMode {
    const count = this.getRecentWriteCount();
    if (count >= this.config.deferredThresholdOps) return "deferred";
    if (count >= this.config.aggressiveThresholdOps) return "aggressive";
    return "normal";
  }
}

let singleton: QuotaGovernor | null = null;

/**
 * Sub-step H.3: lazily-constructed process-wide singleton (per Cloud Run
 * instance - see class-level disclosure above). Config is read once from
 * loadEnv() on first access.
 */
export function getQuotaGovernor(): QuotaGovernor {
  if (!singleton) {
    const env = loadEnv();
    singleton = new QuotaGovernor({
      windowMs: env.QUOTA_WINDOW_MS,
      aggressiveThresholdOps: env.QUOTA_AGGRESSIVE_THRESHOLD_OPS,
      deferredThresholdOps: env.QUOTA_DEFERRED_THRESHOLD_OPS,
    });
  }
  return singleton;
}

/**
 * Test/ops utility: allows resetting the singleton, e.g. between test
 * runs. Not used by production code paths.
 */
export function resetQuotaGovernorForTests(): void {
  singleton = null;
}