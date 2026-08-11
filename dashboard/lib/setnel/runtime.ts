// Setnel detector runtime — per-dashboard.
//
// This file is the small kit each dashboard carries. Detectors are defined with
// defineDetector() in detectors.ts; runDetectors() executes them and POSTs any
// events to the Setnel Hub, signed with this dashboard's shared secret.
//
// Eventually this becomes the `@datumlabs/setnel` package. For now it lives in
// the repo so there's nothing to publish/install.

import { createHmac } from 'node:crypto';

export type Severity = 'info' | 'warning' | 'critical' | 'emergency';

export type Category =
  | 'liquidity'
  | 'liquidations'
  | 'flows'
  | 'risk-parameters'
  | 'oracles'
  | 'governance'
  | 'revenue'
  | 'whale-activity'
  | 'depegging'
  | 'technical';

export type DetectorEvent = {
  message: string;
  // Stable dedup key. Include the asset/pool/wallet so distinct breaches don't
  // collapse into one incident. e.g. `aave.utilization-cliff:USDT`.
  fingerprint: string;
  // Deep-link path within this dashboard, e.g. `/markets/USDT`.
  linkPath?: string;
  payload?: Record<string, unknown>;
};

export type Detector<T = unknown> = {
  id: string;
  label: string;
  category: Category;
  severity: Severity;
  // Fetch the data this detector needs. Reuse the dashboard's own API routes.
  source: () => Promise<T>;
  // Pure-ish: given current data, return zero or more events to fire.
  detect: (current: T) => DetectorEvent[] | Promise<DetectorEvent[]>;
};

const registry: Detector[] = [];

export function defineDetector<T>(d: Detector<T>): void {
  registry.push(d as Detector);
}

export function getDetectors(): Detector[] {
  return registry;
}

type RunOptions = {
  dashboardId: string;
  hubUrl: string;
  secret: string;
};

type RunReport = {
  ran: number;
  events: number;
  errors: { detector: string; error: string }[];
  hub?: unknown;
};

/** Execute every registered detector and POST the combined batch to the Hub. */
export async function runDetectors(opts: RunOptions): Promise<RunReport> {
  const detectors = getDetectors();
  const errors: RunReport['errors'] = [];
  const batch: Array<DetectorEvent & { detectorId: string; category: Category; severity: Severity }> = [];

  for (const d of detectors) {
    try {
      const data = await d.source();
      const events = await d.detect(data);
      for (const e of events) {
        batch.push({
          ...e,
          detectorId: d.id,
          category: d.category,
          severity: d.severity,
        });
      }
    } catch (err) {
      errors.push({ detector: d.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const body = JSON.stringify({
    dashboardId: opts.dashboardId,
    events: batch.map((e) => ({
      detectorId: e.detectorId,
      category: e.category,
      severity: e.severity,
      message: e.message,
      fingerprint: e.fingerprint,
      linkPath: e.linkPath,
      payload: e.payload,
    })),
  });

  const signature = createHmac('sha256', opts.secret).update(body).digest('hex');

  let hub: unknown;
  try {
    const res = await fetch(`${opts.hubUrl.replace(/\/$/, '')}/api/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-setnel-signature': signature },
      body,
    });
    hub = await res.json().catch(() => ({ status: res.status }));
  } catch (err) {
    errors.push({ detector: '_hub', error: err instanceof Error ? err.message : String(err) });
  }

  return { ran: detectors.length, events: batch.length, errors, hub };
}
