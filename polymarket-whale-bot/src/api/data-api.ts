import { ApiConfig, ClosedPosition, DataPosition, HolderGroup, LeaderboardEntry, PolymarketTrade } from '../types';
import { HttpClient } from './http-client';

export class DataApi {
  private readonly client: HttpClient;

  constructor(config: ApiConfig) {
    this.client = new HttpClient(config.dataApiUrl, {
      timeoutMs: config.timeoutMs,
      retries: config.retryCount,
      minSpacingMs: config.minRequestSpacingMs,
    });
  }

  async getLeaderboard(category: string, timePeriod: string, orderBy: string, limit = 50): Promise<LeaderboardEntry[]> {
    return this.client.get<LeaderboardEntry[]>(`/v1/leaderboard?category=${category}&timePeriod=${timePeriod}&orderBy=${orderBy}&limit=${limit}`);
  }

  async getActivity(user: string, limit = 100): Promise<PolymarketTrade[]> {
    return this.client.get<PolymarketTrade[]>(`/activity?user=${user}&limit=${limit}&type=TRADE&sortBy=TIMESTAMP&sortDirection=DESC`);
  }

  async getPositions(user: string, sizeThreshold = 1000, limit = 50): Promise<DataPosition[]> {
    return this.client.get<DataPosition[]>(`/positions?user=${user}&sizeThreshold=${sizeThreshold}&limit=${limit}`);
  }

  async getClosedPositions(user: string, limit = 200): Promise<ClosedPosition[]> {
    return this.client.get<ClosedPosition[]>(`/closed-positions?user=${user}&limit=${limit}`);
  }

  async getHolders(conditionId: string, limit = 20, minBalance = 1): Promise<HolderGroup[]> {
    return this.client.get<HolderGroup[]>(`/holders?market=${conditionId}&limit=${limit}&minBalance=${minBalance}`);
  }

  async getPortfolioValue(user: string): Promise<number> {
    const response = await this.client.get<Array<{ user: string; value: number }> | { user?: string; value?: number }>(`/value?user=${user}`);
    if (Array.isArray(response)) {
      return Number(response[0]?.value ?? 0);
    }
    return Number(response.value ?? 0);
  }
}
