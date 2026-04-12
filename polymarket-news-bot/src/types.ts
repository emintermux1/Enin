export interface ScrapedPost {
  source: 'polymarketg' | 'predictiondesknews' | string
  messageId: string
  text: string
  imageUrl?: string
  timestamp: number
  links: { text: string; url: string }[]
  hasPhoto: boolean
  polymarketSlug?: string
}

export interface MarketData {
  id: string
  question: string
  slug: string
  eventSlug: string
  image: string
  outcomes: string[]
  outcomePrices: number[]
  volume: number
  volume24hr: number
  liquidity: number
  endDate: string
  tags: string[]
  active: boolean
  closed: boolean
  createdAt?: string
  updatedAt?: string
  description?: string
}

export type PostType =
  | 'breaking_news'
  | 'market_spotlight'
  | 'new_market'
  | 'price_mover'
  | 'flash_alert'
  | 'resolution'
  | 'market_pulse'
  | 'trending_digest'

export interface InlineButton {
  text: string
  url: string
}

export interface QueuedPost {
  id: string
  type: PostType
  priority: number
  caption: string
  imageBuffer?: Buffer
  imageUrl?: string
  buttons: InlineButton[]
  sourceId: string
  createdAt: number
  market?: MarketData
}

export interface GammaTag {
  id: string
  label: string
  slug: string
}

export interface PriceMover {
  market: MarketData
  change: number
  direction: 'up' | 'down'
}
