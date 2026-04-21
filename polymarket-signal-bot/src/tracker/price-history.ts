import { LRUCache } from 'lru-cache';

interface PriceSnapshot {
  price: number;
  timestamp: number;
}

export interface PriceMomentum {
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
  direction: 'up' | 'down' | 'flat';
  periodLabel: string;
}

export class PriceHistory {
  private readonly cache = new LRUCache<string, PriceSnapshot[]>({
    max: 2000,
    ttl: 1000 * 60 * 60 * 4,
  });

  record(marketKey: string, price: number): void {
    if (!marketKey || !Number.isFinite(price) || price <= 0) {
      return;
    }

    const snapshots = this.cache.get(marketKey) || [];
    const now = Date.now();
    snapshots.push({ price, timestamp: now });
    const cutoff = now - 4 * 60 * 60 * 1000;
    const pruned = snapshots.filter((snapshot) => snapshot.timestamp >= cutoff).slice(-100);
    this.cache.set(marketKey, pruned);
  }

  getMomentum(marketKey: string, currentPrice: number): PriceMomentum | null {
    if (!marketKey || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      return null;
    }

    const snapshots = this.cache.get(marketKey);
    if (!snapshots || snapshots.length < 2) {
      return null;
    }

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const candidates = snapshots.filter(
      (snapshot) =>
        snapshot.timestamp >= oneHourAgo - 30 * 60 * 1000
        && snapshot.timestamp <= oneHourAgo + 30 * 60 * 1000,
    );
    if (candidates.length === 0) {
      return null;
    }

    const reference = candidates.reduce((best, snapshot) =>
      Math.abs(snapshot.timestamp - oneHourAgo) < Math.abs(best.timestamp - oneHourAgo) ? snapshot : best,
    );
    if (reference.price <= 0) {
      return null;
    }

    const changePercent = ((currentPrice - reference.price) / reference.price) * 100;
    return {
      currentPrice,
      previousPrice: reference.price,
      changePercent: Math.round(changePercent),
      direction: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
      periodLabel: '1h',
    };
  }
}
