import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export interface AppConfig {
  telegram: {
    botToken: string
    channelId: string
    communityUrl: string
    communityButtonText: string
  }
  polymarket: {
    gammaApiUrl: string
    timeoutMs: number
    retryCount: number
    minRequestSpacingMs: number
  }
  scraping: {
    channels: string[]
    pollIntervalMs: number
  }
  monitoring: {
    trendingPollMs: number
    trendingDigestIntervalMs: number
    newMarketPollMs: number
    priceMovePollMs: number
    resolutionPollMs: number
    minVolumeForTrending: number
    minPriceChangePercent: number
    minVolumeForNewMarket: number
  }
  posting: {
    minIntervalMs: number
    maxPostsPerHour: number
    quietHoursStart: number
    quietHoursEnd: number
  }
  runtime: {
    dryRun: boolean
    databasePath: string
    userAgent: string
  }
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readString(name: string, fallback = ''): string {
  const raw = process.env[name]
  return raw?.trim() || fallback
}

function readCsv(name: string, fallback: string[]): string[] {
  const raw = readString(name)
  if (!raw) {
    return fallback
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export const config: AppConfig = {
  telegram: {
    botToken: readString('TELEGRAM_BOT_TOKEN'),
    channelId: readString('TELEGRAM_CHANNEL_ID'),
    communityUrl: readString('COMMUNITY_URL', 'https://t.me/+4NxSCfeCHnw2MDQ0'),
    communityButtonText: readString(
      'COMMUNITY_BUTTON_TEXT',
      '👥 Traders Community'
    ),
  },
  polymarket: {
    gammaApiUrl: readString(
      'GAMMA_API_URL',
      'https://gamma-api.polymarket.com'
    ),
    timeoutMs: readNumber('POLYMARKET_TIMEOUT_MS', 15_000),
    retryCount: readNumber('POLYMARKET_RETRY_COUNT', 3),
    minRequestSpacingMs: readNumber('POLYMARKET_MIN_SPACING_MS', 50),
  },
  scraping: {
    channels: readCsv('SCRAPE_CHANNELS', [
      'polymarketg',
      'predictiondesknews',
      'polymarket_markets',
    ]),
    pollIntervalMs: readNumber('SCRAPE_POLL_INTERVAL_MS', 90_000),
  },
  monitoring: {
    trendingPollMs: readNumber('TRENDING_POLL_MS', 300_000),
    trendingDigestIntervalMs: readNumber(
      'TRENDING_DIGEST_INTERVAL_MS',
      86_400_000
    ),
    newMarketPollMs: readNumber('NEW_MARKET_POLL_MS', 600_000),
    priceMovePollMs: readNumber('PRICE_MOVE_POLL_MS', 180_000),
    resolutionPollMs: readNumber('RESOLUTION_POLL_MS', 300_000),
    minVolumeForTrending: readNumber('MIN_VOLUME_TRENDING', 100_000),
    minPriceChangePercent: readNumber('MIN_PRICE_CHANGE_PERCENT', 10),
    minVolumeForNewMarket: readNumber('MIN_VOLUME_NEW_MARKET', 50_000),
  },
  posting: {
    minIntervalMs: readNumber('MIN_POST_INTERVAL_MS', 120_000),
    maxPostsPerHour: readNumber('MAX_POSTS_PER_HOUR', 15),
    quietHoursStart: readNumber('QUIET_HOURS_START', 2),
    quietHoursEnd: readNumber('QUIET_HOURS_END', 6),
  },
  runtime: {
    dryRun: readNumber('DRY_RUN', 0) === 1,
    databasePath: path.resolve(process.cwd(), 'data', 'polymarket-news-bot.db'),
    userAgent: 'polymarket-news-bot/1.0',
  },
}

if (!config.telegram.botToken) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in .env')
}

if (!config.telegram.channelId) {
  throw new Error('Missing TELEGRAM_CHANNEL_ID in .env')
}
