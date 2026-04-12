import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger';
import { HttpClient } from './http-client';

export interface PolynterMarket {
  id: string;
  title: string;
  slug: string;
  eventSlug: string;
  image: string;
  price: number;
  pricePercent: number;
  side: string;
  volume: number;
  liquidity: number;
  endDate: string;
  apy: number;
  tags: string[];
  polymarketUrl: string;
}

interface PolynterMarketsResponse {
  markets?: PolynterMarket[];
}

export class PolynterApi {
  private readonly client: HttpClient;
  private readonly marketCache = new LRUCache<string, PolynterMarket>({
    max: 2000,
    ttl: 1000 * 60 * 30,
  });

  constructor() {
    this.client = new HttpClient('https://polynter.net/api/v1', {
      timeoutMs: 15_000,
      retries: 2,
      minSpacingMs: 200,
    });
  }

  async getMarkets(page = 1): Promise<PolynterMarket[]> {
    try {
      const response = await this.client.get<PolynterMarketsResponse>(`/markets-99?page=${page}`);
      const markets = response.markets ?? [];
      for (const market of markets) {
        if (market.slug) {
          this.marketCache.set(market.slug, market);
        }
      }
      return markets;
    } catch (error) {
      logger.warn(`Polynter markets fetch failed (page ${page})`, error);
      return [];
    }
  }

  async refreshAllMarkets(): Promise<void> {
    for (let page = 1; page <= 5; page += 1) {
      const markets = await this.getMarkets(page);
      if (markets.length === 0) {
        break;
      }
    }
    logger.info(`Polynter cache populated with ${this.marketCache.size} markets`);
  }

  getMarketBySlug(slug: string): PolynterMarket | undefined {
    return this.marketCache.get(slug);
  }

  findMarket(slug: string, title?: string): PolynterMarket | undefined {
    const direct = this.marketCache.get(slug);
    if (direct) {
      return direct;
    }

    const normalizedSlug = slug.toLowerCase();
    const normalizedTitle = title?.toLowerCase();
    for (const [key, market] of this.marketCache.entries()) {
      const marketTitle = market.title.toLowerCase();
      if (normalizedSlug && (key.includes(normalizedSlug) || normalizedSlug.includes(key))) {
        return market;
      }
      if (normalizedTitle && (marketTitle.includes(normalizedTitle) || normalizedTitle.includes(marketTitle))) {
        return market;
      }
    }
    return undefined;
  }
}
