import { config } from '../config'
import { GammaTag, MarketData } from '../types'
import { HttpClient } from '../utils/http-client'

interface GammaEvent {
  id: string | number
  title?: string
  slug?: string
  image?: string
  icon?: string
  volume?: number | string
  volume24hr?: number | string
  liquidity?: number | string
  endDate?: string
  creationDate?: string
  createdAt?: string
  updatedAt?: string
  active?: boolean
  closed?: boolean
  description?: string
  tags?: Array<{ id?: string; label?: string; slug?: string } | string>
  markets?: GammaMarket[]
}

interface GammaMarket {
  id: string | number
  question?: string
  slug?: string
  image?: string
  outcomes?: string | string[]
  outcomePrices?: string | number[]
  volume?: string | number
  active?: boolean
  closed?: boolean
  createdAt?: string
  updatedAt?: string
  endDate?: string
}

function parseNumeric(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (!value) {
    return 0
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseStringArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value.map(String)
  }
  try {
    const parsed = JSON.parse(value) as string[]
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseNumberArray(value: string | number[] | undefined): number[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value.map((item) => parseNumeric(item))
  }
  try {
    const parsed = JSON.parse(value) as Array<string | number>
    return Array.isArray(parsed) ? parsed.map((item) => parseNumeric(item)) : []
  } catch {
    return []
  }
}

function pickPrimaryMarket(event: GammaEvent): GammaMarket | null {
  const markets = Array.isArray(event.markets) ? event.markets : []
  if (markets.length === 0) {
    return null
  }
  return (
    [...markets].sort(
      (a, b) => parseNumeric(b.volume) - parseNumeric(a.volume)
    )[0] ?? null
  )
}

function mapEvent(event: GammaEvent | undefined): MarketData | null {
  if (!event) {
    return null
  }
  const market = pickPrimaryMarket(event)
  if (!market) {
    return null
  }

  const outcomes = parseStringArray(market.outcomes)
  const outcomePrices = parseNumberArray(market.outcomePrices)
  const tags = (event.tags ?? [])
    .map((tag) => {
      if (typeof tag === 'string') {
        return tag
      }
      return tag.label || tag.slug || String(tag.id || '')
    })
    .filter(Boolean)

  return {
    id: String(market.id),
    question: market.question || event.title || 'Untitled market',
    slug: market.slug || event.slug || String(market.id),
    eventSlug: event.slug || market.slug || String(event.id),
    image: market.image || event.image || event.icon || '',
    outcomes,
    outcomePrices,
    volume: parseNumeric(market.volume || event.volume),
    volume24hr: parseNumeric(event.volume24hr),
    liquidity: parseNumeric(event.liquidity),
    endDate: market.endDate || event.endDate || '',
    tags,
    active: Boolean(market.active ?? event.active),
    closed: Boolean(market.closed ?? event.closed),
    createdAt: market.createdAt || event.creationDate || event.createdAt,
    updatedAt: market.updatedAt || event.updatedAt,
    description: event.description,
  }
}

export class PolymarketApi {
  private readonly http: HttpClient

  constructor() {
    this.http = new HttpClient(config.polymarket.gammaApiUrl, {
      timeoutMs: config.polymarket.timeoutMs,
      retries: config.polymarket.retryCount,
      minSpacingMs: config.polymarket.minRequestSpacingMs,
    })
  }

  async getTopEvents(limit: number, offset: number): Promise<MarketData[]> {
    const events = await this.http.get<GammaEvent[]>(
      `/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=${limit}&offset=${offset}`
    )
    return events
      .map(mapEvent)
      .filter((item): item is MarketData => Boolean(item))
  }

  async getEventsByTag(tagId: string, limit: number): Promise<MarketData[]> {
    const events = await this.http.get<GammaEvent[]>(
      `/events?active=true&closed=false&tag_id=${encodeURIComponent(tagId)}&limit=${limit}`
    )
    return events
      .map(mapEvent)
      .filter((item): item is MarketData => Boolean(item))
  }

  async getEventBySlug(slug: string): Promise<MarketData | null> {
    const events = await this.http.get<GammaEvent[]>(
      `/events?slug=${encodeURIComponent(slug)}&limit=1`
    )
    if (!events[0]) {
      return null
    }
    return mapEvent(events[0])
  }

  async getResolvedMarkets(hoursBack: number): Promise<MarketData[]> {
    const events = await this.http.get<GammaEvent[]>(
      '/events?closed=true&limit=100&order=updatedAt&ascending=false'
    )
    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000
    return events
      .map(mapEvent)
      .filter((item): item is MarketData => Boolean(item))
      .filter((market) => {
        const updatedAt = market.updatedAt
          ? new Date(market.updatedAt).getTime()
          : 0
        const winner = Math.max(...market.outcomePrices, 0)
        return market.closed && winner >= 0.99 && updatedAt >= cutoff
      })
  }

  async searchMarkets(query: string): Promise<MarketData[]> {
    const events = await this.http.get<GammaEvent[]>(
      `/events?search=${encodeURIComponent(query)}&limit=15`
    )
    return events
      .map(mapEvent)
      .filter((item): item is MarketData => Boolean(item))
  }

  async getTags(): Promise<GammaTag[]> {
    return this.http.get<GammaTag[]>('/tags')
  }

  async getNewestEvents(limit: number): Promise<MarketData[]> {
    const events = await this.http.get<GammaEvent[]>(
      `/events?active=true&closed=false&order=createdAt&ascending=false&limit=${limit}`
    )
    return events
      .map(mapEvent)
      .filter((item): item is MarketData => Boolean(item))
  }
}
