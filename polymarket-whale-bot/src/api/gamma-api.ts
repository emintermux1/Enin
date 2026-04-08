import { ApiConfig, MarketInfo } from '../types';
import { HttpClient } from './http-client';

interface GammaMarketResponse {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate?: string;
  endDateIso?: string;
  expirationDate?: string;
  closeTime?: string;
  liquidity?: number | string;
  liquidityNum?: number;
  image?: string;
  icon?: string;
  outcomes?: string[] | string;
  outcomePrices?: number[] | string[] | string;
  volume?: number | string;
  volumeNum?: number;
  eventSlug?: string;
  events?: GammaEventResponse[];
}

interface GammaEventResponse {
  id: string;
  slug?: string;
  title?: string;
  endDate?: string;
  endDateIso?: string;
  expirationDate?: string;
  closeTime?: string;
  image?: string;
  icon?: string;
  volume?: number | string;
  liquidity?: number | string;
  tags?: GammaTag[];
  markets?: GammaMarketResponse[];
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

  async getMarketBySlug(
    slug: string,
    options?: { eventSlug?: string; conditionId?: string }
  ): Promise<MarketInfo | null> {
    const markets = await this.client.get<GammaMarketResponse[]>(`/markets?slug=${encodeURIComponent(slug)}`);
    const market = markets[0];
    if (market) {
      const tags = await this.getMarketTags(market.id).catch(() => [] as string[]);
      const outcomes = parseArray<string>(market.outcomes, []);
      const outcomePricesRaw = parseArray<number | string>(market.outcomePrices, []);
      const outcomePrices = outcomePricesRaw.map((value) => Number(value)).filter((value) => Number.isFinite(value));
      const endDate =
        this.resolveEndDate(market) ||
        this.resolveEndDate(market.events?.[0]) ||
        (await this.getEventEndDate(market).catch(() => ''));
      return {
        id: market.id,
        question: market.question,
        image: market.image || market.icon || '',
        endDate: endDate || '',
        outcomes,
        outcomePrices,
        volume: Number(market.volumeNum ?? market.volume ?? 0),
        liquidity: Number(market.liquidityNum ?? market.liquidity ?? 0),
        tags,
        eventSlug: market.eventSlug || market.events?.[0]?.slug || slug,
        slug: market.slug,
      };
    }

    const eventSlug = options?.eventSlug && options.eventSlug !== slug ? options.eventSlug : slug;
    const event = await this.getEventBySlug(eventSlug).catch(() => null);
    if (!event) {
      return null;
    }
    return this.buildMarketInfoFromEvent(event, slug, options?.conditionId);
  }

  async getMarketTags(marketId: string): Promise<string[]> {
    const tags = await this.client.get<GammaTag[]>(`/markets/${marketId}/tags`);
    return tags.map((tag) => tag.label).filter(Boolean);
  }

  private resolveEndDate(
    entity?: Pick<GammaMarketResponse, 'endDateIso' | 'endDate' | 'expirationDate' | 'closeTime'>
  ): string {
    return entity?.endDateIso || entity?.endDate || entity?.expirationDate || entity?.closeTime || '';
  }

  private async getEventEndDate(market: GammaMarketResponse): Promise<string> {
    const eventSlug = market.eventSlug || market.events?.[0]?.slug;
    if (!eventSlug) {
      return '';
    }
    const event = await this.getEventBySlug(eventSlug);
    return this.resolveEndDate(event ?? undefined);
  }

  private async getEventBySlug(slug: string): Promise<GammaEventResponse | null> {
    const events = await this.client.get<GammaEventResponse[]>(`/events?slug=${encodeURIComponent(slug)}`);
    return events[0] ?? null;
  }

  private buildMarketInfoFromEvent(
    event: GammaEventResponse,
    requestedSlug: string,
    conditionId?: string
  ): MarketInfo {
    const eventMarket =
      event.markets?.find((candidate) => candidate.conditionId === conditionId) ||
      event.markets?.find((candidate) => candidate.slug === requestedSlug) ||
      event.markets?.[0];
    const outcomes = parseArray<string>(eventMarket?.outcomes, []);
    const outcomePricesRaw = parseArray<number | string>(eventMarket?.outcomePrices, []);
    const outcomePrices = outcomePricesRaw.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    const tags = event.tags?.map((tag) => tag.label).filter(Boolean) ?? [];
    return {
      id: eventMarket?.id || event.id,
      question: eventMarket?.question || event.title || '',
      image: eventMarket?.image || eventMarket?.icon || event.image || event.icon || '',
      endDate: this.resolveEndDate(eventMarket) || this.resolveEndDate(event) || '',
      outcomes,
      outcomePrices,
      volume: Number(eventMarket?.volumeNum ?? eventMarket?.volume ?? event.volume ?? 0),
      liquidity: Number(eventMarket?.liquidityNum ?? eventMarket?.liquidity ?? event.liquidity ?? 0),
      tags,
      eventSlug: event.slug || requestedSlug,
      slug: eventMarket?.slug || requestedSlug,
    };
  }
}
