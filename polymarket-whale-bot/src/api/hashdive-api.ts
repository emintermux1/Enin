import { LRUCache } from 'lru-cache';
import { PolymarketTrade, TrackedWallet } from '../types';
import { logger } from '../utils/logger';
import { GammaApi, GammaMarketLookup } from './gamma-api';
import { HttpClient } from './http-client';

export interface HashdiveTradeResponse {
  asset_id: string;
  market_info?: {
    is_winner: boolean;
    outcome: string;
    question: string;
    resolved: boolean;
    resolved_price: number | null;
    tags: string[];
    target_price: number;
  };
  price: number;
  shares: number;
  side: 'b' | 's';
  timestamp: string | number;
  usd_amount: number;
  user_address: string;
}

export interface HashdiveWhaleTradeResponse extends HashdiveTradeResponse {}

export interface HashdiveTraderProfile {
  totalTrades: number;
  resolvedWins: number;
  resolvedLosses: number;
  resolvedWinRate: number;
  totalVolumeUsd: number;
  tags: string[];
  topCategory: string | null;
}

interface HashdiveMarketResolution {
  conditionId: string;
  slug: string;
  eventSlug: string;
  question: string;
  outcomes: string[];
  image: string;
}

const EMPTY_MARKET = { empty: true } as const;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export class HashdiveApi {
  private readonly client: HttpClient;
  private readonly apiKey: string;
  private readonly marketCache = new LRUCache<
    string,
    HashdiveMarketResolution | typeof EMPTY_MARKET
  >({
    max: 500,
    ttl: 1000 * 60 * 60,
  });

  constructor(apiKey: string, timeoutMs = 5_000) {
    this.apiKey = apiKey;
    this.client = new HttpClient('https://hashdive.com/api', {
      timeoutMs,
      retries: 0,
      minSpacingMs: 200,
    });
  }

  async getTraderTrades(walletAddress: string, pageSize = 100): Promise<HashdiveTradeResponse[]> {
    try {
      return await this.client.get<HashdiveTradeResponse[]>(
        `/get_trades?user_address=${walletAddress}&page_size=${pageSize}&format=json&api_key=${this.apiKey}`,
      );
    } catch (error) {
      logger.warn(`Hashdive get_trades failed for ${walletAddress}: ${formatErrorMessage(error)}`);
      return [];
    }
  }

  async getLatestWhaleTrades(minUsd = 10_000, limit = 50): Promise<HashdiveWhaleTradeResponse[]> {
    try {
      return await this.client.get<HashdiveWhaleTradeResponse[]>(
        `/get_latest_whale_trades?min_usd=${minUsd}&limit=${limit}&format=json&api_key=${this.apiKey}`,
      );
    } catch (error) {
      logger.warn(`Hashdive get_latest_whale_trades failed: ${formatErrorMessage(error)}`);
      return [];
    }
  }

  buildTraderProfile(trades: HashdiveTradeResponse[]): HashdiveTraderProfile {
    const resolvedTrades = trades.filter((trade) => trade.market_info?.resolved === true);
    const wins = resolvedTrades.filter((trade) => trade.market_info?.is_winner === true).length;
    const losses = resolvedTrades.filter((trade) => trade.market_info?.is_winner === false).length;
    const totalVolumeUsd = trades.reduce((sum, trade) => sum + Number(trade.usd_amount || 0), 0);

    const tagCounts: Record<string, number> = {};
    for (const trade of trades) {
      for (const tag of trade.market_info?.tags || []) {
        const clean = tag.trim();
        if (clean && !clean.startsWith('Earn')) {
          tagCounts[clean] = (tagCounts[clean] || 0) + 1;
        }
      }
    }
    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);

    return {
      totalTrades: trades.length,
      resolvedWins: wins,
      resolvedLosses: losses,
      resolvedWinRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
      totalVolumeUsd,
      tags: sortedTags.slice(0, 10),
      topCategory: sortedTags[0] || null,
    };
  }

  async mapToPolymarketTrade(
    trade: HashdiveWhaleTradeResponse,
    options: {
      gammaApi: GammaApi;
      trackedWallet?: TrackedWallet;
    },
  ): Promise<PolymarketTrade> {
    const wallet = String(trade.user_address || '').toLowerCase();
    const timestamp = this.normalizeTimestamp(trade.timestamp);
    const market = await this.resolveMarket(trade, options.gammaApi);
    const shortWallet = wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : 'unknown';
    const outcome = String(trade.market_info?.outcome || '').trim();
    const matchedOutcomeIndex = market?.outcomes.findIndex(
      (candidate) => normalizeText(candidate) === normalizeText(outcome),
    );
    const outcomeIndex = matchedOutcomeIndex !== undefined && matchedOutcomeIndex >= 0 ? matchedOutcomeIndex : 0;
    const fallbackSlug = slugify(trade.market_info?.question || `hashdive-${trade.asset_id || timestamp}`) || `hashdive-${timestamp}`;
    const displayName = options.trackedWallet?.userName || shortWallet;

    return {
      proxyWallet: wallet,
      timestamp,
      conditionId: market?.conditionId || String(trade.asset_id || ''),
      type: 'TRADE',
      size: Number(trade.shares || 0),
      usdcSize: Number(trade.usd_amount || 0),
      transactionHash: `hashdive-${wallet}-${trade.asset_id}-${timestamp}`,
      price: Number(trade.price || 0),
      asset: String(trade.asset_id || ''),
      side: trade.side === 's' ? 'SELL' : 'BUY',
      outcomeIndex,
      title: market?.question || trade.market_info?.question || fallbackSlug,
      slug: market?.slug || fallbackSlug,
      icon: market?.image || '',
      eventSlug: market?.eventSlug || market?.slug || fallbackSlug,
      outcome: outcome || market?.outcomes[outcomeIndex] || '',
      name: displayName,
      pseudonym: options.trackedWallet?.xUsername || shortWallet,
      bio: '',
      profileImage: options.trackedWallet?.profileImage || '',
    };
  }

  private async resolveMarket(
    trade: HashdiveWhaleTradeResponse,
    gammaApi: GammaApi,
  ): Promise<HashdiveMarketResolution | null> {
    const cacheKey = `${trade.asset_id}:${normalizeText(trade.market_info?.question || '')}`;
    const cached = this.marketCache.get(cacheKey);
    if (cached !== undefined) {
      return 'empty' in cached ? null : cached;
    }

    const candidateSets: GammaMarketLookup[][] = [];
    if (trade.asset_id) {
      const byCondition = await gammaApi.findMarkets({
        conditionId: String(trade.asset_id),
        limit: 5,
      }).catch(() => []);
      if (byCondition.length > 0) {
        candidateSets.push(byCondition);
      }
    }
    if (trade.market_info?.question) {
      const byQuestion = await gammaApi.findMarkets({
        search: trade.market_info.question,
        limit: 10,
      }).catch(() => []);
      if (byQuestion.length > 0) {
        candidateSets.push(byQuestion);
      }
    }

    const bestMatch = candidateSets
      .flat()
      .sort(
        (left, right) =>
          this.scoreMarketMatch(trade, right) - this.scoreMarketMatch(trade, left),
      )[0];
    const resolved = bestMatch
      ? {
          conditionId: bestMatch.conditionId,
          slug: bestMatch.slug,
          eventSlug: bestMatch.eventSlug || bestMatch.events?.[0]?.slug || bestMatch.slug,
          question: bestMatch.question,
          outcomes: Array.isArray(bestMatch.outcomes)
            ? bestMatch.outcomes
            : this.parseOutcomeArray(bestMatch.outcomes),
          image: bestMatch.image || bestMatch.icon || '',
        }
      : null;
    this.marketCache.set(cacheKey, resolved ?? EMPTY_MARKET);
    return resolved;
  }

  private scoreMarketMatch(trade: HashdiveWhaleTradeResponse, candidate: GammaMarketLookup): number {
    let score = 0;
    const tradeQuestion = normalizeText(trade.market_info?.question || '');
    const candidateQuestion = normalizeText(candidate.question || '');
    const tradeOutcome = normalizeText(trade.market_info?.outcome || '');
    const outcomes = Array.isArray(candidate.outcomes)
      ? candidate.outcomes
      : this.parseOutcomeArray(candidate.outcomes);

    if (trade.asset_id && candidate.conditionId === String(trade.asset_id)) {
      score += 100;
    }
    if (tradeQuestion && candidateQuestion === tradeQuestion) {
      score += 80;
    } else if (
      tradeQuestion &&
      candidateQuestion &&
      (candidateQuestion.includes(tradeQuestion) || tradeQuestion.includes(candidateQuestion))
    ) {
      score += 40;
    }
    if (
      tradeOutcome &&
      outcomes.some((candidateOutcome) => normalizeText(candidateOutcome) === tradeOutcome)
    ) {
      score += 20;
    }
    return score;
  }

  private parseOutcomeArray(value: string[] | string | undefined): string[] {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }
    try {
      const parsed = JSON.parse(value) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private normalizeTimestamp(timestamp: string | number): number {
    if (typeof timestamp === 'string') {
      const parsedDate = Date.parse(timestamp);
      if (Number.isFinite(parsedDate)) {
        return Math.floor(parsedDate / 1000);
      }
      const parsedNumber = Number(timestamp);
      if (Number.isFinite(parsedNumber)) {
        return parsedNumber > 1_000_000_000_000
          ? Math.floor(parsedNumber / 1000)
          : Math.floor(parsedNumber);
      }
    }
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return timestamp > 1_000_000_000_000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
    }
    return Math.floor(Date.now() / 1000);
  }
}
