import { ApiConfig, MarketInfo } from '../types';
import { HttpClient } from './http-client';

interface GammaMarketResponse {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate?: string;
  endDateIso?: string;
  liquidity?: number | string;
  liquidityNum?: number;
  image?: string;
  icon?: string;
  outcomes?: string[] | string;
  outcomePrices?: number[] | string[] | string;
  volume?: number | string;
  volumeNum?: number;
  eventSlug?: string;
}

interface GammaTag {
  id: string;
  label: string;
  slug: string;
}

function parseArray<T>(value: T[] | string | undefined, fallback: T[]): T[] {
  if (!value) {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export class GammaApi {
  private readonly client: HttpClient;

  constructor(config: ApiConfig) {
    this.client = new HttpClient(config.gammaApiUrl, {
      timeoutMs: config.timeoutMs,
      retries: config.retryCount,
      minSpacingMs: config.minRequestSpacingMs,
    });
  }

  async getMarketBySlug(slug: string): Promise<MarketInfo | null> {
    const markets = await this.client.get<GammaMarketResponse[]>(`/markets?slug=${encodeURIComponent(slug)}`);
    const market = markets[0];
    if (!market) {
      return null;
    }
    const tags = await this.getMarketTags(market.id).catch(() => [] as string[]);
    const outcomes = parseArray<string>(market.outcomes, []);
    const outcomePricesRaw = parseArray<number | string>(market.outcomePrices, []);
    const outcomePrices = outcomePricesRaw.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    return {
      id: market.id,
      question: market.question,
      image: market.image || market.icon || '',
      endDate: market.endDateIso || market.endDate || '',
      outcomes,
      outcomePrices,
      volume: Number(market.volumeNum ?? market.volume ?? 0),
      liquidity: Number(market.liquidityNum ?? market.liquidity ?? 0),
      tags,
      eventSlug: market.eventSlug || slug,
      slug: market.slug,
    };
  }

  async getMarketTags(marketId: string): Promise<string[]> {
    const tags = await this.client.get<GammaTag[]>(`/markets/${marketId}/tags`);
    return tags.map((tag) => tag.label).filter(Boolean);
  }
}
