/*
 * Adaptive bitrate selection.
 *
 * Bandwidth is estimated with two exponentially weighted moving averages
 * (fast and slow half-life); the lower one wins, so the estimate drops quickly
 * and recovers slowly. Selection also looks at buffer health: with little
 * buffer the player steps down one level to avoid a stall.
 */

class Ewma {
  private alpha: number;
  private estimate = 0;
  private totalWeight = 0;
  constructor(halfLife: number) {
    this.alpha = Math.exp(Math.log(0.5) / halfLife);
  }
  sample(weight: number, value: number) {
    const a = Math.pow(this.alpha, weight);
    this.estimate = value * (1 - a) + a * this.estimate;
    this.totalWeight += weight;
  }
  get(): number {
    const zeroFactor = 1 - Math.pow(this.alpha, this.totalWeight);
    return zeroFactor ? this.estimate / zeroFactor : 0;
  }
}

export interface AbrOptions {
  /** Assumed bandwidth (bits/s) before the first samples. */
  defaultBandwidth?: number;
  /** Fraction of the estimate a level may use. */
  safety?: number;
  /** Buffer (s) below which the player prefers a lower level. */
  lowBuffer?: number;
}

export interface AbrLevel {
  bandwidth: number;
  height: number;
}

export class BandwidthEstimator {
  private fast = new Ewma(2);
  private slow = new Ewma(5);
  private bytes = 0;
  private readonly fallback: number;

  constructor(defaultBandwidth = 1_500_000) {
    this.fallback = defaultBandwidth;
  }

  /** Records a finished download. Tiny responses are ignored (latency-bound). */
  sample(durationMs: number, bytes: number) {
    if (bytes < 16000 || durationMs <= 0) return;
    const bps = (8000 * bytes) / durationMs;
    const weight = durationMs / 1000;
    this.bytes += bytes;
    this.fast.sample(weight, bps);
    this.slow.sample(weight, bps);
  }

  estimate(): number {
    if (this.bytes < 128000) return this.fallback;
    return Math.min(this.fast.get(), this.slow.get());
  }
}

/**
 * Picks the index of the best level (levels sorted by bandwidth ascending).
 * `cap` limits the height range (0 = no limit).
 */
export function chooseLevel(levels: AbrLevel[], estimate: number, buffer: number, current: number, opts: AbrOptions & { minHeight?: number; maxHeight?: number } = {}): number {
  const safety = opts.safety ?? 0.85;
  const lowBuffer = opts.lowBuffer ?? 6;
  const allowed = levels
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => (!opts.maxHeight || !l.height || l.height <= opts.maxHeight) && (!opts.minHeight || !l.height || l.height >= opts.minHeight));
  if (!allowed.length) return 0;
  let pick = allowed[0].i;
  for (const { l, i } of allowed) if (l.bandwidth <= estimate * safety) pick = i;
  // Avoid switching up while the buffer is thin; step down when it is critical.
  if (current >= 0 && pick > current && buffer < lowBuffer) pick = current;
  if (current >= 0 && buffer < lowBuffer / 2 && pick >= current) {
    const lower = allowed.filter(({ i }) => i < current);
    if (lower.length) pick = lower[lower.length - 1].i;
  }
  return pick;
}
