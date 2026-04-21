import { LRUCache } from 'lru-cache';

interface MarketEntry {
  wallet: string;
  side: 'BUY' | 'SELL';
  amount: number;
  timestamp: number;
}

export interface CoordinationSignal {
  walletsOnSameSide: number;
  totalAmount: number;
  timeWindowMinutes: number;
  isCoordinated: boolean;
}

export class CoordinationDetector {
  private readonly recentTrades = new LRUCache<string, MarketEntry[]>({
    max: 500,
    ttl: 1000 * 60 * 60,
  });

  private readonly COORDINATION_WINDOW_MS = 30 * 60 * 1000;
  private readonly MIN_WALLETS_FOR_COORDINATION = 3;

  recordAndCheck(conditionId: string, wallet: string, side: 'BUY' | 'SELL', amount: number): CoordinationSignal {
    const now = Date.now();
    const entries = this.recentTrades.get(conditionId) ?? [];

    entries.push({ wallet: wallet.toLowerCase(), side, amount, timestamp: now });

    const cutoff = now - this.COORDINATION_WINDOW_MS;
    const recent = entries.filter((entry) => entry.timestamp >= cutoff);
    this.recentTrades.set(conditionId, recent);

    const sameSideEntries = recent.filter((entry) => entry.side === side);
    const sameSideWallets = new Set(sameSideEntries.map((entry) => entry.wallet));
    const totalSameSideAmount = sameSideEntries.reduce((sum, entry) => sum + entry.amount, 0);

    return {
      walletsOnSameSide: sameSideWallets.size,
      totalAmount: totalSameSideAmount,
      timeWindowMinutes: 30,
      isCoordinated: sameSideWallets.size >= this.MIN_WALLETS_FOR_COORDINATION,
    };
  }
}
