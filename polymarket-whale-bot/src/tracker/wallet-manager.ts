import { DataApi } from '../api/data-api';
import { LeaderboardQuery, TrackedWallet, TrackingConfig } from '../types';
import { logger } from '../utils/logger';

const QUERIES: LeaderboardQuery[] = [
  { category: 'OVERALL', timePeriod: 'ALL', orderBy: 'PNL', limit: 50, label: 'overall-all-pnl' },
  { category: 'OVERALL', timePeriod: 'ALL', orderBy: 'VOL', limit: 50, label: 'overall-all-vol' },
  { category: 'OVERALL', timePeriod: 'MONTH', orderBy: 'PNL', limit: 50, label: 'overall-month-pnl' },
  { category: 'OVERALL', timePeriod: 'WEEK', orderBy: 'PNL', limit: 50, label: 'overall-week-pnl' },
  { category: 'OVERALL', timePeriod: 'DAY', orderBy: 'VOL', limit: 50, label: 'overall-day-vol' },
  { category: 'POLITICS', timePeriod: 'ALL', orderBy: 'PNL', limit: 50, label: 'politics-all-pnl' },
  { category: 'CRYPTO', timePeriod: 'ALL', orderBy: 'PNL', limit: 50, label: 'crypto-all-pnl' },
  { category: 'SPORTS', timePeriod: 'ALL', orderBy: 'PNL', limit: 50, label: 'sports-all-pnl' },
];

function normalizeWallet(wallet: string): string {
  return wallet.toLowerCase();
}

export class WalletManager {
  private wallets = new Map<string, TrackedWallet>();
  private lastRefreshAt = 0;

  constructor(
    private readonly dataApi: DataApi,
    private readonly tracking: TrackingConfig,
  ) {}

  async refreshIfNeeded(force = false): Promise<boolean> {
    const refreshIntervalMs = this.tracking.leaderboardRefreshHours * 60 * 60 * 1000;
    if (!force && Date.now() - this.lastRefreshAt < refreshIntervalMs && this.wallets.size > 0) {
      return false;
    }
    await this.refreshWallets();
    return true;
  }

  async refreshWallets(): Promise<void> {
    logger.info('Refreshing tracked wallets from leaderboard...');
    const results = await Promise.allSettled(
      QUERIES.map(async (query) => ({ query, entries: await this.dataApi.getLeaderboard(query.category, query.timePeriod, query.orderBy, query.limit) })),
    );

    const wallets = new Map<string, TrackedWallet>();
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        logger.warn('Leaderboard query failed', result.reason);
        continue;
      }
      const { query, entries } = result.value;
      for (const entry of entries) {
        const key = normalizeWallet(entry.proxyWallet);
        const current = wallets.get(key) ?? {
          proxyWallet: key,
          userName: '',
          xUsername: '',
          profileImage: '',
          verifiedBadge: false,
          pnl: 0,
          vol: 0,
          allTimeTop50: false,
          sources: [],
        };
        current.userName = current.userName || entry.userName || entry.xUsername || key.slice(0, 8);
        current.xUsername = current.xUsername || entry.xUsername || '';
        current.profileImage = current.profileImage || entry.profileImage || '';
        current.verifiedBadge = current.verifiedBadge || Boolean(entry.verifiedBadge);
        current.pnl = Math.max(current.pnl, Number(entry.pnl || 0));
        current.vol = Math.max(current.vol, Number(entry.vol || 0));
        const rank = Number(entry.rank || 0) || undefined;
        if (query.orderBy === 'PNL' && rank) {
          current.bestPnlRank = current.bestPnlRank ? Math.min(current.bestPnlRank, rank) : rank;
          if (query.category === 'OVERALL' && query.timePeriod === 'ALL') {
            current.overallPnlRank = rank;
          }
        }
        if (query.orderBy === 'VOL' && rank) {
          current.bestVolRank = current.bestVolRank ? Math.min(current.bestVolRank, rank) : rank;
          if (query.category === 'OVERALL' && query.timePeriod === 'ALL') {
            current.overallVolRank = rank;
          }
        }
        if (!current.sources.includes(query.label)) {
          current.sources.push(query.label);
        }
        if (query.category === 'OVERALL' && query.timePeriod === 'ALL') {
          current.allTimeTop50 = true;
        }
        wallets.set(key, current);
      }
    }

    const trimmed = [...wallets.values()]
      .sort((a, b) => (b.pnl + b.vol) - (a.pnl + a.vol))
      .slice(0, this.tracking.maxTrackedWallets);

    this.wallets = new Map(trimmed.map((wallet) => [wallet.proxyWallet, wallet]));
    this.lastRefreshAt = Date.now();
    logger.info(`Tracking ${this.wallets.size} unique whale wallets`);
  }

  getWallets(): TrackedWallet[] {
    return [...this.wallets.values()];
  }

  getWallet(address: string): TrackedWallet | undefined {
    return this.wallets.get(normalizeWallet(address));
  }

  isTracked(address: string): boolean {
    return this.wallets.has(normalizeWallet(address));
  }
}
