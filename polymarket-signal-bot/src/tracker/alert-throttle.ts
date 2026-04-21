import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger';

interface ThrottleEntry {
  count: number;
  firstSeenAt: number;
}

interface MarketDailyCountEntry {
  date: string;
  count: number;
}

export class AlertThrottle {
  private readonly cache: LRUCache<string, ThrottleEntry>;
  private readonly marketDailyCounts = new Map<string, MarketDailyCountEntry>();

  constructor(private readonly getMaxAlerts: () => number = () => 5) {
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
    const maxAlertsPerDay = Math.max(1, Math.floor(this.getMaxAlerts()));

    if (!entry) {
      this.cache.set(key, { count: 1, firstSeenAt: Date.now() });
      return true;
    }

    if (entry.count < maxAlertsPerDay) {
      entry.count += 1;
      this.cache.set(key, entry);
      return true;
    }

    if (entry.count === maxAlertsPerDay) {
      entry.count += 1;
      this.cache.set(key, entry);
      logger.info(
        `Throttled: wallet ${wallet.slice(0, 8)}... on market ${conditionId.slice(0, 12)}... (>${maxAlertsPerDay} alerts/day)`,
      );
    }

    return false;
  }

  isMarketThrottled(conditionId: string): boolean {
    if (!conditionId) {
      return false;
    }

    const normalizedConditionId = conditionId.toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.marketDailyCounts.get(normalizedConditionId);

    if (!entry || entry.date !== today) {
      this.marketDailyCounts.set(normalizedConditionId, { date: today, count: 1 });
      return false;
    }

    if (entry.count >= 5) {
      if (entry.count === 5) {
        entry.count += 1;
        this.marketDailyCounts.set(normalizedConditionId, entry);
        logger.info(
          `Throttled: market ${conditionId.slice(0, 12)}... (>5 alerts/day across all wallets)`,
        );
      }
      return true;
    }

    entry.count += 1;
    this.marketDailyCounts.set(normalizedConditionId, entry);
    return false;
  }
}
