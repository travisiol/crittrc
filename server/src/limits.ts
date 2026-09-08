/**
 * Token buckets, in memory. Enough to stop a script hammering a route or a
 * socket; not a substitute for a proxy in front of the server, and it says
 * so rather than pretending otherwise.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  /**
   * @param capacity how many actions may burst
   * @param perSecond how fast the bucket refills
   */
  constructor(
    private capacity: number,
    private perSecond: number,
  ) {}

  /** True when the action is allowed, and it consumes one token. */
  take(key: string, cost = 1): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updatedAt: now };
      this.buckets.set(key, b);
    }
    const elapsed = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.perSecond);
    b.updatedAt = now;
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  /** Seconds until one token is back, for the message shown to the caller. */
  retryAfter(key: string): number {
    const b = this.buckets.get(key);
    if (!b || b.tokens >= 1) return 0;
    return Math.ceil((1 - b.tokens) / this.perSecond);
  }

  /** Drop buckets nobody has touched for a while. */
  prune(olderThanMs = 10 * 60_000) {
    const cutoff = Date.now() - olderThanMs;
    for (const [key, b] of this.buckets) if (b.updatedAt < cutoff) this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * One bucket per concern. Signing in is cheap but scriptable; creating a
 * keeper and cashing out are the two that cost the game something.
 */
export const limits = {
  /** Any HTTP request from one address. */
  http: new RateLimiter(60, 2),
  /** Sign-in attempts: a nonce plus a verify is two. */
  auth: new RateLimiter(12, 0.2),
  /** Keeper creation, on top of the one-name-an-hour rule. */
  keeper: new RateLimiter(3, 0.002),
  /** Cashing out and asking for a voucher. */
  earn: new RateLimiter(10, 0.05),
  /** Socket actions other than movement. */
  action: new RateLimiter(25, 4),
};

export function pruneLimits() {
  for (const l of Object.values(limits)) l.prune();
}
