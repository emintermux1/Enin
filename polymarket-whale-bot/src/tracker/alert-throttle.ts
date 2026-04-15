import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger';

interface ThrottleEntry {
  count: number;
  firstSeenAt: number;
}

export class AlertThrottle {
  private readonly cache: LRUCache<string, ThrottleEntry>;
  private readonly maxAlertsPerDay: number;

  constructor(maxAlertsPerDay = 3) {
    this.maxAlertsPerDay = maxAlertsPerDay;
    this.cache = new LRUCache<string, ThrottleEntry>({
      max: 50_000,
      ttl: 1000 * 60 * 60 * 24,
    });
  }

  shouldAlert(wallet: string, conditionId: string): boolean {
    if (!conditionId) {
      return true;
    }

    const key = `${wallet.toLowerCase()}:${conditionId.toLowerCase()}`;
    const entry = this.cache.get(key);

    if (!entry) {
      this.cache.set(key, { count: 1, firstSeenAt: Date.now() });
      return true;
    }

    if (entry.count < this.maxAlertsPerDay) {
      entry.count += 1;
      this.cache.set(key, entry);
      return true;
    }

    if (entry.count === this.maxAlertsPerDay) {
      entry.count += 1;
      this.cache.set(key, entry);
      logger.info(
        `Throttled: wallet ${wallet.slice(0, 8)}... on market ${conditionId.slice(0, 12)}... (>${this.maxAlertsPerDay} alerts/day)`,
      );
    }

    return false;
  }
}
