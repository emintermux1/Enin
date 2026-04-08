import { LRUCache } from 'lru-cache';
import { GammaApi } from '../api/gamma-api';
import { DataApi } from '../api/data-api';
import { classifyTrader } from '../classifier/trader-classifier';
import { classifyRisk } from '../classifier/risk-classifier';
import {
  DataPosition,
  EnrichedTrade,
  HolderStats,
  MarketInfo,
  PolymarketTrade,
  TraderStats,
} from '../types';
import { WalletManager } from './wallet-manager';
import { logger } from '../utils/logger';

interface TraderStatsSnapshot {
  traderStats: TraderStats;
  recentTradeCount: number;
  positions: DataPosition[];
  closedPositions: Array<{ title: string; realizedPnl: number; timestamp: number }>;
}

function normalizeWallet(wallet: string): string {
  return wallet.toLowerCase();
}

export class TradeEnricher {
  private static readonly CATEGORY_KEYWORDS: Record<string, string[]> = {
    Politics: ['president', 'election', 'minister', 'congress', 'senate', 'vote', 'governor', 'democrat', 'republican', 'trump', 'biden', 'party', 'political', 'cabinet'],
    Sports: ['nba', 'nfl', 'soccer', 'football', 'basketball', 'baseball', 'tennis', 'ufc', 'match', 'championship', 'super bowl', 'premier league', 'world cup', 'playoffs', 'mvp'],
    Crypto: ['bitcoin', 'ethereum', 'btc', 'eth', 'crypto', 'solana', 'token', 'blockchain', 'defi', 'altcoin', 'memecoin'],
    Geopolitics: ['war', 'conflict', 'ceasefire', 'iran', 'russia', 'ukraine', 'china', 'nato', 'sanctions', 'invasion', 'military', 'peace', 'treaty'],
    Culture: ['oscar', 'grammy', 'emmy', 'movie', 'music', 'celebrity', 'tiktok', 'youtube', 'influencer', 'awards', 'show'],
    Economics: ['gdp', 'inflation', 'fed', 'interest rate', 'recession', 'stock', 'oil', 'commodity', 'tariff', 'unemployment', 'cpi'],
  };

  private readonly traderStatsCache = new LRUCache<string, TraderStatsSnapshot>({ max: 500, ttl: 1000 * 60 * 10 });
  private readonly marketCache = new LRUCache<string, MarketInfo>({ max: 500, ttl: 1000 * 60 * 60 });

  constructor(
    private readonly dataApi: DataApi,
    private readonly gammaApi: GammaApi,
    private readonly walletManager: WalletManager,
  ) {}

  async enrichTrade(trade: PolymarketTrade): Promise<EnrichedTrade> {
    const trackedWallet = this.walletManager.getWallet(trade.proxyWallet);
    const [statsSnapshot, marketInfo, holders] = await Promise.all([
      this.getTraderStats(trade.proxyWallet),
      this.getMarketInfo(trade),
      this.getHolderStats(trade),
    ]);

    const convictionBuild = statsSnapshot.positions.some(
      (position) => position.conditionId === trade.conditionId && position.totalBought > trade.usdcSize * 1.5,
    );

    const holderStats = await this.decorateInsiderCount(holders, trade.proxyWallet, statsSnapshot.traderStats);
    const classification = classifyTrader({
      trade,
      traderStats: statsSnapshot.traderStats,
      trackedWallet,
      holderStats,
      recentTradeCount: statsSnapshot.recentTradeCount,
      convictionBuild,
    });

    const price = Math.max(trade.price || 0.01, 0.01);
    const topCategory = this.determineTopCategory(statsSnapshot.positions, statsSnapshot.closedPositions);
    const freshWalletsInMarket = this.countFreshWallets(holders.addresses);

    return {
      trade,
      traderStats: statsSnapshot.traderStats,
      marketInfo,
      holderStats,
      traderTypes: classification.traderTypes,
      primaryType: classification.primaryType,
      risk: classifyRisk(price),
      potentialWin: trade.usdcSize / price,
      multiplier: 1 / price,
      isFreshWallet: statsSnapshot.recentTradeCount > 0 && statsSnapshot.recentTradeCount < 20,
      topCategory,
      freshWalletsInMarket,
    };
  }

  private async getTraderStats(wallet: string): Promise<TraderStatsSnapshot> {
    const key = normalizeWallet(wallet);
    const cached = this.traderStatsCache.get(key);
    if (cached) {
      return cached;
    }

    const [positionsResult, closedResult, portfolioResult, recentActivityResult] = await Promise.allSettled([
      this.dataApi.getPositions(wallet, 1000, 50),
      this.dataApi.getClosedPositions(wallet, 200),
      this.dataApi.getPortfolioValue(wallet),
      this.dataApi.getActivity(wallet, 100),
    ]);

    const positions = positionsResult.status === 'fulfilled' ? positionsResult.value : [];
    const closedPositions = closedResult.status === 'fulfilled' ? closedResult.value : [];
    const portfolioValueFromApi = portfolioResult.status === 'fulfilled' ? portfolioResult.value : 0;
    const recentActivity = recentActivityResult.status === 'fulfilled' ? recentActivityResult.value : [];
    const bestWinStreak = this.calculateBestWinStreak(closedPositions);
    const activityTimestamps = recentActivity.map((entry) => Number(entry.timestamp || 0)).filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
    const closedTimestamps = closedPositions.map((position) => Number(position.timestamp || 0)).filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
    const earliestTimestamp = [...activityTimestamps, ...closedTimestamps].sort((a, b) => a - b)[0];

    const totalPositionsValue = positions.reduce((sum, position) => sum + Number(position.currentValue || 0), 0);
    const totalRealizedPnl = closedPositions.reduce((sum, position) => sum + Number(position.realizedPnl || 0), 0);
    const wins = closedPositions.filter((position) => Number(position.realizedPnl || 0) > 0).length;
    const losses = Math.max(0, closedPositions.length - wins);
    const winRate = closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0;

    const traderStats: TraderStats = {
      totalPositionsValue,
      closedPositions: closedPositions.length,
      wins,
      losses,
      winRate,
      winRateLabel: `${Math.round(winRate)}% (${wins}W-${losses}L)`,
      totalRealizedPnl,
      portfolioValue: Math.max(totalPositionsValue, portfolioValueFromApi),
      bestWinStreak,
      activeSince: earliestTimestamp ? new Date(earliestTimestamp * 1000).toISOString() : null,
      observedTradeCount: recentActivity.length,
    };

    const snapshot: TraderStatsSnapshot = {
      traderStats,
      recentTradeCount: recentActivity.length,
      positions,
      closedPositions: closedPositions.map((position) => ({
        title: position.title,
        realizedPnl: Number(position.realizedPnl || 0),
        timestamp: position.timestamp,
      })),
    };
    this.traderStatsCache.set(key, snapshot);
    return snapshot;
  }

  private async getMarketInfo(trade: PolymarketTrade): Promise<MarketInfo> {
    const cached = this.marketCache.get(trade.slug);
    if (cached) {
      return cached;
    }
    const market = await this.gammaApi.getMarketBySlug(trade.slug).catch((error) => {
      logger.warn(`Failed to fetch market for ${trade.slug}`, error);
      return null;
    });
    const fallback: MarketInfo = market ?? {
      id: trade.conditionId,
      question: trade.title,
      image: trade.icon,
      endDate: '',
      outcomes: [trade.outcome],
      outcomePrices: [trade.price],
      volume: 0,
      liquidity: 0,
      tags: [],
      eventSlug: trade.eventSlug,
      slug: trade.slug,
    };
    this.marketCache.set(trade.slug, fallback);
    return fallback;
  }

  private async getHolderStats(trade: PolymarketTrade): Promise<HolderStats & { addresses: string[] }> {
    const groups = await this.dataApi.getHolders(trade.conditionId, 20, 1).catch((error) => {
      logger.warn(`Failed to fetch holders for ${trade.conditionId}`, error);
      return [];
    });
    const holders = groups.flatMap((group) => group.holders ?? []);
    const relevantHolders = holders.filter((holder) => holder.outcomeIndex === trade.outcomeIndex);
    const addresses = [...new Set(holders.map((holder) => normalizeWallet(holder.proxyWallet)).filter(Boolean))];
    const whalesInMarket = new Set(addresses.filter((address) => this.walletManager.isTracked(address))).size;
    const totalTopHolders = Math.max(
      20,
      ...groups
        .filter((group) => (group.holders ?? []).some((holder) => holder.outcomeIndex === trade.outcomeIndex))
        .map((group) => group.holders.length),
      relevantHolders.length,
    );

    return {
      topHoldersOnSide: relevantHolders.length,
      totalTopHolders,
      side: trade.outcome || String(trade.outcomeIndex),
      whalesInMarket,
      insidersInMarket: 0,
      traderIsTopHolder: addresses.includes(normalizeWallet(trade.proxyWallet)),
      addresses,
    };
  }

  private async decorateInsiderCount(
    holderStats: HolderStats & { addresses: string[] },
    traderWallet: string,
    traderStats: TraderStats,
  ): Promise<HolderStats> {
    const insiderAddresses = new Set<string>();
    for (const address of holderStats.addresses) {
      const cached = this.traderStatsCache.get(address);
      if (cached && cached.traderStats.winRate >= 80 && cached.traderStats.closedPositions >= 5) {
        insiderAddresses.add(address);
      }
    }
    if (traderStats.winRate >= 80 && traderStats.closedPositions >= 5 && holderStats.addresses.includes(normalizeWallet(traderWallet))) {
      insiderAddresses.add(normalizeWallet(traderWallet));
    }
    return {
      topHoldersOnSide: holderStats.topHoldersOnSide,
      totalTopHolders: holderStats.totalTopHolders,
      side: holderStats.side,
      whalesInMarket: holderStats.whalesInMarket,
      insidersInMarket: insiderAddresses.size,
      traderIsTopHolder: holderStats.traderIsTopHolder,
    };
  }

  private determineTopCategory(
    positions: DataPosition[],
    closedPositions: Array<{ title: string }>,
  ): string | null {
    const allTitles = [...positions.map((position) => position.title), ...closedPositions.map((position) => position.title)].filter(Boolean);

    if (allTitles.length === 0) {
      return null;
    }

    const scores: Record<string, number> = {};
    for (const title of allTitles) {
      const lower = title.toLowerCase();
      for (const [category, keywords] of Object.entries(TradeEnricher.CATEGORY_KEYWORDS)) {
        for (const keyword of keywords) {
          if (lower.includes(keyword)) {
            scores[category] = (scores[category] || 0) + 1;
            break;
          }
        }
      }
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? null;
  }

  private countFreshWallets(addresses: string[]): number {
    let count = 0;
    for (const address of addresses) {
      const cached = this.traderStatsCache.get(address);
      if (cached && cached.recentTradeCount > 0 && cached.recentTradeCount < 20) {
        count += 1;
      }
    }
    return count;
  }

  private calculateBestWinStreak(closedPositions: Array<{ realizedPnl: number; timestamp: number }>): number | null {
    if (closedPositions.length === 0) {
      return null;
    }
    let current = 0;
    let best = 0;
    for (const position of [...closedPositions].sort((a, b) => a.timestamp - b.timestamp)) {
      if (Number(position.realizedPnl || 0) > 0) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
    return best || null;
  }
}
