import { HttpClient } from './http-client';
import { logger } from '../utils/logger';

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

export class HashdiveApi {
  private readonly client: HttpClient;
  private readonly apiKey: string;

  constructor(apiKey: string, timeoutMs = 20_000) {
    this.apiKey = apiKey;
    this.client = new HttpClient('https://hashdive.com/api', {
      timeoutMs,
      retries: 1,
      minSpacingMs: 200,
    });
  }

  async getTraderTrades(walletAddress: string, pageSize = 100): Promise<HashdiveTradeResponse[]> {
    try {
      return await this.client.get<HashdiveTradeResponse[]>(
        `/get_trades?user_address=${walletAddress}&page_size=${pageSize}&format=json&api_key=${this.apiKey}`,
      );
    } catch (error) {
      logger.warn(`Hashdive get_trades failed for ${walletAddress}`, error);
      return [];
    }
  }

  async getLatestWhaleTrades(minUsd = 10_000, limit = 50): Promise<HashdiveWhaleTradeResponse[]> {
    try {
      return await this.client.get<HashdiveWhaleTradeResponse[]>(
        `/get_latest_whale_trades?min_usd=${minUsd}&limit=${limit}&format=json&api_key=${this.apiKey}`,
      );
    } catch (error) {
      logger.warn('Hashdive get_latest_whale_trades failed', error);
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
}
