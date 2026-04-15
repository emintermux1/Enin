import { config } from './config'
import { MarketCardGenerator } from './content/market-card'
import { PostComposer } from './content/post-composer'
import { initDatabase, NewsDatabase } from './db/database'
import { PolymarketApi } from './sources/polymarket-api'
import { ChannelScraper } from './sources/channel-scraper'
import { MarketMonitor } from './sources/market-monitor'
import { TwitterScraper } from './sources/twitter-scraper'
import { TelegramPublisher } from './telegram/publisher'
import { MarketData, ScrapedPost } from './types'
import { computeFingerprint } from './utils/fingerprint'
import { logger } from './utils/logger'

let fatalExitTimer: NodeJS.Timeout | null = null
let database: NewsDatabase | null = null

function scheduleFatalExit() {
  if (fatalExitTimer) {
    return
  }
  fatalExitTimer = setTimeout(() => process.exit(1), 30_000)
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err)
  scheduleFatalExit()
})

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', err)
  scheduleFatalExit()
})

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  const stopwords = new Set([
    'will',
    'with',
    'from',
    'that',
    'have',
    'this',
    'just',
    'into',
    'about',
    'after',
    'before',
    'market',
    'polymarket',
    'trade',
    'breaking',
    'news',
  ])
  return Array.from(
    new Set(
      normalize(text)
        .split(' ')
        .filter((word) => word.length >= 4 && !stopwords.has(word))
    )
  ).slice(0, 8)
}

function scoreOverlap(text: string, market: MarketData): number {
  const sourceTokens = new Set(tokenize(text))
  const marketTokens = new Set(
    tokenize(`${market.question} ${market.tags.join(' ')}`)
  )
  let score = 0
  sourceTokens.forEach((token) => {
    if (marketTokens.has(token)) {
      score += token.length
    }
  })
  return score
}

async function findRelatedMarket(
  polymarketApi: PolymarketApi,
  text: string
): Promise<MarketData | undefined> {
  const tokens = tokenize(text)
  if (tokens.length === 0) {
    return undefined
  }
  const query = tokens.slice(0, 5).join(' ')
  const candidates = await polymarketApi.searchMarkets(query)
  const ranked = candidates
    .map((market) => ({ market, score: scoreOverlap(text, market) }))
    .sort((a, b) => b.score - a.score)
  return ranked[0] && ranked[0].score >= 8 ? ranked[0].market : undefined
}

function startLoop(
  name: string,
  intervalMs: number,
  task: () => Promise<void>
): NodeJS.Timeout {
  const run = async () => {
    try {
      await task()
    } catch (error) {
      logger.warn(`${name} loop failed`, error)
    }
  }
  void run()
  return setInterval(() => void run(), intervalMs)
}

async function processScrapedPost(
  postComposer: PostComposer,
  publisher: TelegramPublisher,
  polymarketApi: PolymarketApi,
  db: NewsDatabase,
  post: ScrapedPost
): Promise<void> {
  const fingerprint = computeFingerprint(post.text)
  if (fingerprint && db.hasRecentFingerprint(fingerprint)) {
    logger.debug(`Skipping duplicate content from ${post.source}:${post.messageId}`)
    return
  }

  let relatedMarket: MarketData | undefined

  if (post.polymarketSlug) {
    relatedMarket =
      (await polymarketApi.getEventBySlug(post.polymarketSlug)) ?? undefined

    if (!relatedMarket) {
      const slugAsText = post.polymarketSlug.replace(/-/g, ' ')
      relatedMarket = await findRelatedMarket(polymarketApi, slugAsText)
    }
  }

  if (!relatedMarket) {
    relatedMarket = await findRelatedMarket(polymarketApi, post.text)
  }

  const queued = await postComposer.composeFromScraped(post, relatedMarket)
  if (!queued) {
    return
  }
  if (fingerprint) {
    db.recordFingerprint(fingerprint, `${post.source}:${post.messageId}`)
  }
  publisher.queuePost(queued)
}

async function main() {
  logger.info('Starting Polymarket News Bot...')

  database = initDatabase()
  const polymarketApi = new PolymarketApi()
  const channelScraper = new ChannelScraper()
  const twitterScraper = new TwitterScraper()
  const marketMonitor = new MarketMonitor(polymarketApi, database)
  const cardGenerator = new MarketCardGenerator()
  const postComposer = new PostComposer(cardGenerator)
  const publisher = new TelegramPublisher(config.telegram, database)
  const timers: NodeJS.Timeout[] = []

  await publisher.launch()

  timers.push(
    startLoop('scraping', config.scraping.pollIntervalMs, async () => {
      for (const channel of config.scraping.channels) {
        const posts = await channelScraper.scrapeChannel(channel)
        for (const post of posts) {
          try {
            await processScrapedPost(
              postComposer,
              publisher,
              polymarketApi,
              database!,
              post
            )
          } catch (error) {
            logger.warn(
              `Failed to process scraped post ${post.source}:${post.messageId}`,
              error
            )
          }
        }
      }
    })
  )

  timers.push(
    startLoop(
      'trending-digest',
      config.monitoring.trendingDigestIntervalMs,
      async () => {
        const markets = await marketMonitor.getTrendingDigestMarkets()
        if (markets.length === 0) {
          return
        }
        const queued = await postComposer.composeTrendingDigest(markets)
        const pinnedMessageId = database?.getPinnedDigestMessageId() ?? null

        if (!pinnedMessageId) {
          logger.warn('No pinned digest to update, skipping trending-digest')
          return
        }

        const edited = await publisher.editPinnedDigest(
          pinnedMessageId,
          queued.caption,
          queued.buttons
        )
        if (edited) {
          logger.info(`Updated pinned trending digest #${pinnedMessageId}`)
          return
        }

        logger.warn(
          `Failed to update pinned trending digest #${pinnedMessageId}, skipping`
        )
      }
    )
  )

  timers.push(
    startLoop('twitter-polymarket', 300_000, async () => {
      const tweets = await twitterScraper.scrapePolymarketTweets()
      for (const tweet of tweets) {
        try {
          await processScrapedPost(
            postComposer,
            publisher,
            polymarketApi,
            database!,
            tweet
          )
        } catch (error) {
          logger.warn(
            `Failed to process scraped post ${tweet.source}:${tweet.messageId}`,
            error
          )
        }
      }
    })
  )

  timers.push(
    startLoop('new-markets', config.monitoring.newMarketPollMs, async () => {
      const newMarkets = await marketMonitor.getNewNotableMarkets()
      for (const market of newMarkets) {
        const queued = await postComposer.composeNewMarket(market)
        publisher.queuePost(queued)
      }
    })
  )

  timers.push(
    startLoop('price-movers', config.monitoring.priceMovePollMs, async () => {
      const movers = await marketMonitor.getPriceMovers()
      for (const { market, change, direction } of movers) {
        const queued = await postComposer.composePriceMover(
          market,
          change,
          direction
        )
        publisher.queuePost(queued)
      }
    })
  )

  timers.push(
    startLoop('flash-alerts', config.monitoring.flashAlertPollMs, async () => {
      const alerts = await marketMonitor.getFlashAlerts()
      for (const { market, change, direction } of alerts) {
        const queued = await postComposer.composeFlashAlert(
          market,
          change,
          direction
        )
        publisher.queuePost(queued)
      }
    })
  )

  timers.push(setInterval(() => void publisher.processQueue(), 30_000))
  await publisher.processQueue()

  const shutdown = async () => {
    logger.info('Shutting down...')
    timers.forEach((timer) => clearInterval(timer))
    await publisher.stop()
    database?.close()
    database = null
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

main().catch((error) => {
  logger.error('Fatal startup error', error)
  database?.close()
  database = null
  scheduleFatalExit()
})
