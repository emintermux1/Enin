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
  SignalAssessment,
  TraderStats,
  TrackedWallet,
} from '../types';
import { WalletManager } from './wallet-manager';
import { logger } from '../utils/logger';

interface TraderStatsSnapshot {
  traderStats: TraderStats;
  recentTradeCount: number;
  positions: DataPosition[];
}

function normalizeWallet(wallet: string): string {
  return wallet.toLowerCase();
}

export class TradeEnricher {
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
    const potentialWin = trade.usdcSize / price;
    const multiplier = 1 / price;
    const signal = this.assessSignal({
      trade,
      stats: statsSnapshot.traderStats,
      holderStats,
      trackedWallet,
      convictionBuild,
      primaryType: classification.primaryType,
    });
    const traderLabel = trade.pseudonym || trade.name || `${trade.proxyWallet.slice(0, 6)}…${trade.proxyWallet.slice(-4)}`;

    return {
      trade,
      traderStats: statsSnapshot.traderStats,
      marketInfo,
      holderStats,
      traderTypes: classification.traderTypes,
      primaryType: classification.primaryType,
      risk: classifyRisk(price),
      potentialWin,
      multiplier,
      signal,
      traderLabel,
      leaderboardSummary: this.buildLeaderboardSummary(trackedWallet),
      trackedWallet,
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
    const activityTimestamps = recentActivity.map((trade) => Number(trade.timestamp || 0)).filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
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

  private buildLeaderboardSummary(trackedWallet?: TrackedWallet): string | null {
    if (!trackedWallet) {
      return null;
    }
    const parts: string[] = [];
    if (trackedWallet.overallPnlRank) {
      parts.push(`#${trackedWallet.overallPnlRank} PNL`);
    } else if (trackedWallet.bestPnlRank) {
      parts.push(`#${trackedWallet.bestPnlRank} PNL`);
    }
    if (trackedWallet.overallVolRank) {
      parts.push(`#${trackedWallet.overallVolRank} VOL`);
    } else if (trackedWallet.bestVolRank) {
      parts.push(`#${trackedWallet.bestVolRank} VOL`);
    }
    return parts.length > 0 ? parts.join(' • ') : null;
  }

  private assessSignal(input: {
    trade: PolymarketTrade;
    stats: TraderStats;
    holderStats: HolderStats;
    trackedWallet?: TrackedWallet;
    convictionBuild: boolean;
    primaryType: EnrichedTrade['primaryType'];
  }): SignalAssessment {
    let score = 36;
    if (input.trade.usdcSize >= 100_000) {
      score += 24;
    } else if (input.trade.usdcSize >= 50_000) {
      score += 18;
    } else if (input.trade.usdcSize >= 20_000) {
      score += 12;
    } else {
      score += 6;
    }

    if (input.stats.winRate >= 85) {
      score += 16;
    } else if (input.stats.winRate >= 70) {
      score += 10;
    } else if (input.stats.winRate >= 55) {
      score += 6;
    }

    if (input.holderStats.traderIsTopHolder) {
      score += 10;
    }
    if (input.holderStats.whalesInMarket >= 5) {
      score += 8;
    } else if (input.holderStats.whalesInMarket >= 2) {
      score += 4;
    }
    if (input.holderStats.insidersInMarket >= 2) {
      score += 7;
    }
    if (input.convictionBuild) {
      score += 8;
    }
    if (input.trackedWallet?.allTimeTop50) {
      score += 8;
    }

    score = Math.min(99, Math.max(25, score));
    if (score >= 85) {
      return { score, confidence: 'A+', summary: 'Elite follow-through', label: 'ALPHA LOCK', emoji: '⚡' };
    }
    if (score >= 72) {
      return { score, confidence: 'A', summary: 'Strong conviction', label: 'SHARP FLOW', emoji: '🎯' };
    }
    if (score >= 58) {
      return { score, confidence: 'B', summary: 'Quality setup', label: 'SMART MONEY', emoji: '📈' };
    }
    return { score, confidence: 'C', summary: 'Early follow', label: 'WATCHLIST', emoji: '👀' };
  }
}
