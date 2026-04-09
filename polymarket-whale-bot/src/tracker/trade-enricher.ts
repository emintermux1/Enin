import { LRUCache } from 'lru-cache';
import { GammaApi } from '../api/gamma-api';
import { DataApi } from '../api/data-api';
import { HashdiveApi, HashdiveTraderProfile } from '../api/hashdive-api';
import { PolygonscanApi } from '../api/polygonscan-api';
import { classifyTrader } from '../classifier/trader-classifier';
import { classifyRisk } from '../classifier/risk-classifier';
import { calculateInsiderScore } from '../classifier/insider-scorer';
import { detectPressure } from '../classifier/pressure-detector';
import { NewsCorrelator } from '../classifier/news-correlator';
import { calculateUnusualScore } from '../classifier/unusual-scorer';
import { WalletTradeRepo } from '../db/wallet-trade-repo';
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
import { PriceHistory } from './price-history';

interface TraderStatsSnapshot {
  traderStats: TraderStats;
  recentTradeCount: number;
  positions: DataPosition[];
  closedPositions: Array<{ title: string; realizedPnl: number; timestamp: number }>;
}

const EMPTY_HASHDIVE_PROFILE = { empty: true } as const;

type HashdiveProfileCacheValue = HashdiveTraderProfile | typeof EMPTY_HASHDIVE_PROFILE;

function normalizeWallet(wallet: string): string {
  return wallet.toLowerCase();
}

export class TradeEnricher {
  private static readonly CATEGORY_KEYWORDS: Record<string, string[]> = {
    Esports: ['esports', 'counter-strike', 'cs2', 'csgo', 'league of legends', 'lol', 'dota', 'valorant', 'overwatch', 'call of duty', 'cod', 'fortnite', 'rocket league', 'rainbow six', 'apex legends', 'esl', 'blast', 'iem', 'major', 'nip', 'faze', 'navi', 'g2', 'fnatic', 'vitality', 'astralis', 'mouz', 'liquid', 'cloud9', 'heroic', 'bo3', 'bo5'],
    Football: ['premier league', 'la liga', 'champions league', 'europa league', 'bundesliga', 'serie a', 'ligue 1', 'world cup', 'mls', 'soccer', 'fc barcelona', 'real madrid', 'manchester', 'liverpool', 'arsenal', 'chelsea', 'tottenham', 'juventus', 'bayern', 'psg', 'inter milan', 'ac milan', 'atletico'],
    Basketball: ['nba', 'basketball', 'lakers', 'celtics', 'warriors', 'bucks', 'nuggets', 'knicks', 'heat', 'suns', 'nets', 'mvp', 'playoffs', 'finals'],
    'American Football': ['nfl', 'super bowl', 'touchdown', 'quarterback', 'chiefs', 'eagles', 'cowboys', 'patriots', '49ers', 'ravens', 'bills'],
    Baseball: ['mlb', 'baseball', 'world series', 'yankees', 'dodgers', 'mets', 'astros', 'red sox'],
    Combat: ['ufc', 'mma', 'boxing', 'fight', 'bout', 'knockout', 'bellator', 'pfl'],
    Tennis: ['tennis', 'wimbledon', 'us open', 'australian open', 'french open', 'atp', 'wta', 'djokovic', 'nadal', 'federer', 'alcaraz', 'sinner'],
    Motorsport: ['formula 1', 'f1', 'nascar', 'grand prix', 'qualifying', 'verstappen', 'hamilton', 'leclerc'],
    Politics: ['president', 'election', 'minister', 'congress', 'senate', 'vote', 'governor', 'democrat', 'republican', 'trump', 'biden', 'party', 'political', 'cabinet', 'parliament', 'prime minister'],
    Crypto: ['bitcoin', 'ethereum', 'btc', 'eth', 'crypto', 'solana', 'token', 'blockchain', 'defi', 'altcoin', 'memecoin', 'price', 'ath'],
    Geopolitics: ['war', 'conflict', 'ceasefire', 'iran', 'russia', 'ukraine', 'china', 'nato', 'sanctions', 'invasion', 'military', 'peace', 'treaty', 'tariff'],
    Culture: ['oscar', 'grammy', 'emmy', 'movie', 'music', 'celebrity', 'tiktok', 'youtube', 'influencer', 'awards', 'show', 'netflix', 'spotify'],
    Economics: ['gdp', 'inflation', 'fed', 'interest rate', 'recession', 'stock', 'oil', 'commodity', 'unemployment', 'cpi', 'fomc'],
  };

  private readonly traderStatsCache = new LRUCache<string, TraderStatsSnapshot>({ max: 500, ttl: 1000 * 60 * 10 });
  private readonly marketCache = new LRUCache<string, MarketInfo>({ max: 500, ttl: 1000 * 60 * 60 });
  private readonly hashdiveProfileCache = new LRUCache<string, HashdiveProfileCacheValue>({
    max: 300,
    ttl: 1000 * 60 * 30,
  });

  constructor(
    private readonly dataApi: DataApi,
    private readonly gammaApi: GammaApi,
    private readonly walletManager: WalletManager,
    private readonly hashdiveApi?: HashdiveApi,
    private readonly polygonscanApi?: PolygonscanApi,
    private readonly walletTradeRepo?: WalletTradeRepo,
    private readonly newsCorrelator?: NewsCorrelator,
    private readonly priceHistory?: PriceHistory,
  ) {}

  async enrichTrade(trade: PolymarketTrade): Promise<EnrichedTrade> {
    const trackedWallet = this.walletManager.getWallet(trade.proxyWallet);
    const marketInfoPromise = this.getMarketInfo(trade);
    const hashdiveProfilePromise = Promise.race([
      this.getHashdiveProfile(trade.proxyWallet).catch((error) => {
        logger.warn(`Hashdive profile fetch failed for ${trade.proxyWallet}`, error);
        return null;
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
    const capitalInflowPromise = this.polygonscanApi
      ? Promise.race([
          this.polygonscanApi.detectFreshInflow(trade.proxyWallet).catch((error) => {
            logger.warn(`Polygonscan inflow detection failed for ${trade.proxyWallet}`, error);
            return null;
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ])
      : Promise.resolve(null);
    const newsCorrelationPromise = this.newsCorrelator
      ? marketInfoPromise.then((marketInfo) =>
          Promise.race([
            this.newsCorrelator!.correlate(marketInfo.question, trade.timestamp).catch((error) => {
              logger.warn(`News correlation failed for ${trade.slug}`, error);
              return null;
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]),
        )
      : Promise.resolve(null);
    const [statsSnapshot, marketInfo, holders, hashdiveProfile, capitalInflow, newsCorrelation] = await Promise.all([
      this.getTraderStats(trade.proxyWallet),
      marketInfoPromise,
      this.getHolderStats(trade),
      hashdiveProfilePromise,
      capitalInflowPromise,
      newsCorrelationPromise,
    ]);

    const convictionBuild = statsSnapshot.positions.some(
      (position) => position.conditionId === trade.conditionId && position.totalBought > trade.usdcSize * 1.5,
    );

    let effectiveWinRate = statsSnapshot.traderStats.winRate;
    let effectiveWins = statsSnapshot.traderStats.wins;
    let effectiveLosses = statsSnapshot.traderStats.losses;
    const hashdiveResolvedCount = (hashdiveProfile?.resolvedWins || 0) + (hashdiveProfile?.resolvedLosses || 0);
    let effectiveClosedPositions = statsSnapshot.traderStats.closedPositions;
    if (hashdiveProfile && hashdiveResolvedCount >= 1) {
      effectiveWinRate = hashdiveProfile.resolvedWinRate;
      effectiveWins = hashdiveProfile.resolvedWins;
      effectiveLosses = hashdiveProfile.resolvedLosses;
      effectiveClosedPositions = hashdiveResolvedCount;
      logger.info(
        `Hashdive resolved stats applied for ${trade.proxyWallet}: ${effectiveWins}W-${effectiveLosses}L (${Math.round(effectiveWinRate)}%)`,
      );
    } else if (this.hashdiveApi && hashdiveProfile) {
      logger.info(
        `Hashdive profile available for ${trade.proxyWallet} but only ${hashdiveResolvedCount} resolved trades; using data-api fallback`,
      );
    } else if (this.hashdiveApi) {
      logger.info(`Hashdive profile unavailable for ${trade.proxyWallet}; using data-api fallback`);
    }

    const effectiveTraderStats: TraderStats = {
      ...statsSnapshot.traderStats,
      closedPositions: effectiveClosedPositions,
      winRate: effectiveWinRate,
      wins: effectiveWins,
      losses: effectiveLosses,
      winRateLabel: `${Math.round(effectiveWinRate)}% (${effectiveWins}W-${effectiveLosses}L)`,
    };
    const price = Math.max(trade.price || 0.01, 0.01);
    if (this.priceHistory) {
      const marketKey = trade.conditionId || trade.slug;
      this.priceHistory.record(marketKey, price);
      const tradeOutcomeIdx = trade.outcomeIndex ?? 0;
      const outcomePrice = marketInfo.outcomePrices[tradeOutcomeIdx];
      if (outcomePrice) {
        this.priceHistory.record(marketKey, outcomePrice);
      }
    }
    const priceMomentum = this.priceHistory?.getMomentum(trade.conditionId || trade.slug, price) ?? null;
    let topCategory = this.determineTopCategory(statsSnapshot.positions, statsSnapshot.closedPositions);
    if (!topCategory && hashdiveProfile?.topCategory) {
      topCategory = hashdiveProfile.topCategory;
    }
    const totalClosedPositions = hashdiveProfile
      ? hashdiveProfile.totalTrades
      : statsSnapshot.traderStats.closedPositions;
    const isFreshWallet = totalClosedPositions >= 0 && totalClosedPositions < 10 && statsSnapshot.positions.length < 5;
    if (isFreshWallet) {
      logger.info(`Fresh wallet detected: ${trade.proxyWallet} (${totalClosedPositions} closed, ${statsSnapshot.positions.length} open)`);
    }
    const insiderScore = calculateInsiderScore({
      winRate: effectiveWinRate,
      closedPositions: effectiveClosedPositions,
      isFreshWallet,
      recentTradeCount: statsSnapshot.recentTradeCount,
      tradePrice: price,
      tradeSize: trade.usdcSize,
      portfolioValue: effectiveTraderStats.portfolioValue,
      totalRealizedPnl: effectiveTraderStats.totalRealizedPnl,
      bestWinStreak: effectiveTraderStats.bestWinStreak,
    });
    const unusualScore = calculateUnusualScore({
      tradeSize: trade.usdcSize,
      marketVolume: marketInfo.volume,
      marketLiquidity: marketInfo.liquidity,
      tradePrice: price,
      portfolioValue: effectiveTraderStats.portfolioValue,
      isFreshWallet,
      winRate: effectiveWinRate,
      closedPositions: effectiveClosedPositions,
    });
    const holderStats = await this.decorateInsiderCount(holders, trade.proxyWallet, effectiveTraderStats);
    const pressureSignal = detectPressure(
      holderStats.topHoldersOnSide,
      holderStats.totalTopHolders,
      trade.outcome,
      holderStats.whalesInMarket,
      trade.side,
    );
    const classification = classifyTrader({
      trade,
      traderStats: effectiveTraderStats,
      trackedWallet,
      holderStats,
      recentTradeCount: statsSnapshot.recentTradeCount,
      convictionBuild,
    });
    const traderTypes = [...classification.traderTypes];
    let primaryType = classification.primaryType;
    if (insiderScore.isInsider && !traderTypes.includes('INSIDER')) {
      traderTypes.push('INSIDER');
      if (primaryType !== 'WHALE') {
        primaryType = 'INSIDER';
      }
    }
    const freshWalletsInMarket = this.countFreshWallets(holders.addresses);
    const risk = classifyRisk(price);
    const potentialWin = trade.usdcSize / price;
    const multiplier = 1 / price;
    const enrichedTrade: EnrichedTrade = {
      trade,
      traderStats: effectiveTraderStats,
      marketInfo,
      holderStats,
      priceMomentum: priceMomentum
        ? {
            changePercent: priceMomentum.changePercent,
            direction: priceMomentum.direction,
            periodLabel: priceMomentum.periodLabel,
          }
        : null,
      xUsername: trackedWallet?.xUsername || undefined,
      traderTypes,
      primaryType,
      risk,
      potentialWin,
      multiplier,
      isFreshWallet,
      topCategory,
      freshWalletsInMarket,
      hashdiveProfile: hashdiveProfile
        ? {
            resolvedWinRate: hashdiveProfile.resolvedWinRate,
            resolvedWins: hashdiveProfile.resolvedWins,
            resolvedLosses: hashdiveProfile.resolvedLosses,
            totalTrades: hashdiveProfile.totalTrades,
            totalVolumeUsd: hashdiveProfile.totalVolumeUsd,
            topCategory: hashdiveProfile.topCategory,
          }
        : undefined,
      insiderScore,
      unusualScore,
      pressureSignal,
      capitalInflow: capitalInflow
        ? {
            hasRecentInflow: capitalInflow.hasRecentInflow,
            totalInflow: capitalInflow.totalInflow,
            largestInflow: capitalInflow.largestInflow,
            inflowCount: capitalInflow.inflowCount,
          }
        : undefined,
      newsCorrelation: newsCorrelation
        ? {
            hasRecentNews: newsCorrelation.hasRecentNews,
            articles: newsCorrelation.articles.map(({ title, source, url, minutesAgo }) => ({
              title,
              source,
              url,
              minutesAgo,
            })),
            strongestSignal: newsCorrelation.strongestSignal,
          }
        : undefined,
    };

    if (this.walletTradeRepo) {
      try {
        this.walletTradeRepo.record({
          wallet: trade.proxyWallet,
          conditionId: trade.conditionId,
          side: trade.side,
          amount: trade.usdcSize,
          price,
          outcome: trade.outcome || String(trade.outcomeIndex),
          marketQuestion: marketInfo.question || trade.title,
          timestamp: trade.timestamp,
          alerted: 0,
          traderName: trade.name || trade.pseudonym || trade.proxyWallet.slice(0, 10),
          primaryType,
          potentialWin,
          multiplier,
        });
      } catch (error) {
        logger.warn(`Wallet trade persistence failed for ${trade.proxyWallet}`, error);
      }
    }

    return enrichedTrade;
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
    const currentStreak = this.calculateCurrentStreak(closedPositions);
    const activityTimestamps = recentActivity.map((entry) => Number(entry.timestamp || 0)).filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
    const closedTimestamps = closedPositions.map((position) => Number(position.timestamp || 0)).filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
    const earliestTimestamp = [...activityTimestamps, ...closedTimestamps].sort((a, b) => a - b)[0];

    const totalPositionsValue = positions.reduce((sum, position) => sum + Number(position.currentValue || 0), 0);
    const totalRealizedPnl = closedPositions.reduce((sum, position) => sum + Number(position.realizedPnl || 0), 0);
    const wins = closedPositions.filter((position) => Number(position.realizedPnl || 0) > 0).length;
    const losses = closedPositions.filter((position) => Number(position.realizedPnl || 0) <= 0).length;
    if (closedPositions.length > 20 && wins === closedPositions.length) {
      logger.warn(`Suspicious closed-position win rate for ${wallet}: ${wins}/${closedPositions.length} positions have positive realized PnL`);
    }
    const winRate = closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0;
    const winningPnls = closedPositions
      .map((position) => Number(position.realizedPnl || 0))
      .filter((pnl) => pnl > 0);
    const bestWinAmount = winningPnls.length > 0 ? Math.max(...winningPnls) : null;

    const traderStats: TraderStats = {
      totalPositionsValue,
      closedPositions: closedPositions.length,
      wins,
      losses,
      winRate,
      winRateLabel: `${Math.round(winRate)}% (${wins}W-${losses}L)`,
      totalRealizedPnl,
      portfolioValue: Math.max(totalPositionsValue, portfolioValueFromApi),
      bestWinAmount,
      bestWinStreak,
      currentStreak,
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

  private async getHashdiveProfile(wallet: string): Promise<HashdiveTraderProfile | null> {
    if (!this.hashdiveApi) {
      return null;
    }

    const key = normalizeWallet(wallet);
    const cached = this.hashdiveProfileCache.get(key);
    if (cached !== undefined) {
      if ('empty' in cached) {
        return null;
      }
      return cached;
    }

    const trades = await this.hashdiveApi.getTraderTrades(wallet, 100);
    if (trades.length === 0) {
      this.hashdiveProfileCache.set(key, EMPTY_HASHDIVE_PROFILE);
      return null;
    }

    const profile = this.hashdiveApi.buildTraderProfile(trades);
    this.hashdiveProfileCache.set(key, profile);
    return profile;
  }

  private async getMarketInfo(trade: PolymarketTrade): Promise<MarketInfo> {
    const cached = this.marketCache.get(trade.slug);
    if (cached) {
      return cached;
    }
    const market = await this.gammaApi.getMarketBySlug(trade.slug, {
      eventSlug: trade.eventSlug,
      conditionId: trade.conditionId,
    }).catch((error) => {
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
    if (!fallback.endDate && trade.title) {
      fallback.endDate = this.extractDateFromTitle(trade.title);
    }
    this.marketCache.set(trade.slug, fallback);
    return fallback;
  }

  private async getHolderStats(trade: PolymarketTrade): Promise<HolderStats & { addresses: string[] }> {
    const groups = await this.dataApi.getHolders(trade.conditionId, 20, 1).catch((error) => {
      logger.warn(`Failed to fetch holders for ${trade.conditionId}`, error);
      return [];
    });
    const holders = groups.flatMap((group) => group.holders ?? []);
    const sameSideHolders = holders.filter((holder) => holder.outcomeIndex === trade.outcomeIndex);
    const oppositeSideHolders = holders.filter((holder) => holder.outcomeIndex !== trade.outcomeIndex);
    const traderWalletNorm = normalizeWallet(trade.proxyWallet);
    const traderRankIndex = sameSideHolders.findIndex(
      (holder) => normalizeWallet(holder.proxyWallet) === traderWalletNorm,
    );
    const traderHolderRank = traderRankIndex >= 0 ? traderRankIndex + 1 : null;
    const addresses = [...new Set(holders.map((holder) => normalizeWallet(holder.proxyWallet)).filter(Boolean))];
    const whalesInMarket = new Set(addresses.filter((address) => this.walletManager.isTracked(address))).size;
    const side = trade.outcome || (trade.outcomeIndex === 0 ? 'Yes' : 'No');
    const sideLower = side.toLowerCase();
    const oppositeSide = sideLower === 'yes' ? 'No' : sideLower === 'no' ? 'Yes' : 'Opposite';

    return {
      topHoldersOnSide: sameSideHolders.length,
      totalTopHolders: addresses.length,
      side,
      oppositeSideHolders: oppositeSideHolders.length,
      oppositeSide,
      whalesInMarket,
      insidersInMarket: 0,
      traderIsTopHolder: traderHolderRank !== null,
      traderHolderRank,
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
      oppositeSideHolders: holderStats.oppositeSideHolders,
      oppositeSide: holderStats.oppositeSide,
      whalesInMarket: holderStats.whalesInMarket,
      insidersInMarket: insiderAddresses.size,
      traderIsTopHolder: holderStats.traderIsTopHolder,
      traderHolderRank: holderStats.traderHolderRank,
    };
  }

  private determineTopCategory(
    positions: DataPosition[],
    closedPositions: Array<{ title: string; realizedPnl: number; timestamp: number }>,
  ): string | null {
    const categoryCounts: Record<string, number> = {};

    for (const position of closedPositions) {
      const titleLower = position.title?.toLowerCase();
      if (!titleLower) {
        continue;
      }
      for (const [category, keywords] of Object.entries(TradeEnricher.CATEGORY_KEYWORDS)) {
        if (keywords.some((keyword) => titleLower.includes(keyword))) {
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;
          break;
        }
      }
    }

    for (const position of positions) {
      const titleLower = position.title?.toLowerCase();
      if (!titleLower) {
        continue;
      }
      for (const [category, keywords] of Object.entries(TradeEnricher.CATEGORY_KEYWORDS)) {
        if (keywords.some((keyword) => titleLower.includes(keyword))) {
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;
          break;
        }
      }
    }

    if (Object.keys(categoryCounts).length === 0) {
      return null;
    }

    return Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  private extractDateFromTitle(title: string): string {
    const monthDayPattern = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i;
    const match = title.match(monthDayPattern);
    if (!match) {
      return '';
    }
    const year = new Date().getFullYear();
    const parsed = new Date(`${match[1]} ${match[2]}, ${year}`);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    if (parsed < new Date()) {
      parsed.setFullYear(year + 1);
    }
    return parsed.toISOString();
  }

  private countFreshWallets(addresses: string[]): number {
    let count = 0;
    for (const address of addresses) {
      const cached = this.traderStatsCache.get(address);
      const cachedTotalTrades = cached?.traderStats.closedPositions ?? -1;
      if (cached && cachedTotalTrades >= 0 && cachedTotalTrades < 10) {
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

  private calculateCurrentStreak(closedPositions: Array<{ realizedPnl: number; timestamp: number }>): number | null {
    if (closedPositions.length === 0) {
      return null;
    }
    const sorted = [...closedPositions].sort((a, b) => b.timestamp - a.timestamp);
    let streak = 0;
    for (const position of sorted) {
      if (Number(position.realizedPnl || 0) > 0) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak > 0 ? streak : null;
  }
}
