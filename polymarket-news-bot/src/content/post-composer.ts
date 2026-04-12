import crypto from 'node:crypto'
import { config } from '../config'
import { InlineButton, MarketData, QueuedPost, ScrapedPost } from '../types'
import {
  formatCompactUsd,
  formatProbability,
  formatDate,
  formatPercent,
  truncateText,
} from '../utils/formatter'
import { MarketCardGenerator } from './market-card'
import {
  escapeHtml,
  trimCaptionForMessage,
  trimCaptionForPhoto,
} from '../telegram/formatters'

function sourceHour(): string {
  return new Date().toISOString().slice(0, 13)
}

function buildMarketUrl(market?: MarketData): string {
  const marketPath = market?.eventSlug || market?.slug
  return marketPath
    ? `https://polymarket.com/event/${marketPath}`
    : 'https://polymarket.com'
}

function buildMarketButtons(market?: MarketData): InlineButton[] {
  const marketUrl = buildMarketUrl(market)
  if (marketUrl !== 'https://polymarket.com') {
    return [
      {
        text: '🔮 Trade on Polymarket',
        url: marketUrl,
      },
      {
        text: config.telegram.communityButtonText,
        url: config.telegram.communityUrl,
      },
    ]
  }
  return [
    { text: '🔮 Open Polymarket', url: 'https://polymarket.com' },
    {
      text: config.telegram.communityButtonText,
      url: config.telegram.communityUrl,
    },
  ]
}

function summarizeOutcomes(market: MarketData): string {
  return market.outcomes
    .slice(0, 4)
    .map(
      (outcome, index) =>
        `• ${escapeHtml(outcome)}: <b>${formatProbability(market.outcomePrices[index] ?? 0)}</b>`
    )
    .join('\n')
}

function buildId(prefix: string, value: string): string {
  return `${prefix}-${crypto.createHash('sha1').update(value).digest('hex').slice(0, 12)}`
}

const SPAM_PATTERNS = [
  /Will the price of .+ be (?:above|below) \$[\d.,]+ on /i,
  /multistrike/i,
  /4h-\d+/i,
]

function isSpamMarket(text: string): boolean {
  return SPAM_PATTERNS.some((pattern) => pattern.test(text))
}

export class PostComposer {
  constructor(private readonly cardGenerator: MarketCardGenerator) {}

  async composeFromScraped(
    post: ScrapedPost,
    relatedMarket?: MarketData
  ): Promise<QueuedPost | null> {
    const cleanedText = post.text.replace(/\s+/g, ' ').trim()
    if (post.source === 'polymarket_markets') {
      if (cleanedText.length < 20 || isSpamMarket(cleanedText)) {
        return null
      }
      if (relatedMarket) {
        const caption = trimCaptionForPhoto(
          `🆕 <b>New on Polymarket</b>\n\n<b>${escapeHtml(relatedMarket.question)}</b>\n\n${summarizeOutcomes(relatedMarket)}${relatedMarket.endDate ? `\n\n🗓 Ends: ${escapeHtml(formatDate(relatedMarket.endDate))}` : ''}`
        )
        return {
          id: buildId('scraped-new', `${post.source}:${post.messageId}`),
          type: 'new_market',
          priority: 60,
          caption,
          imageBuffer:
            await this.cardGenerator.generateNewMarketCard(relatedMarket),
          imageUrl: post.imageUrl,
          buttons: buildMarketButtons(relatedMarket),
          sourceId: `${post.source}:${post.messageId}`,
          createdAt: Date.now(),
          market: relatedMarket,
        }
      }
    }

    const headline = truncateText(cleanedText, 220)
    const context = relatedMarket
      ? `\n\n<b>Related market:</b> ${escapeHtml(relatedMarket.question)}\n${summarizeOutcomes(relatedMarket)}`
      : ''
    const links = post.links
      .slice(0, 2)
      .map(
        (link) =>
          `<a href="${escapeHtml(link.url)}">${escapeHtml(link.text || 'Source')}</a>`
      )
      .join(' • ')
    const caption = trimCaptionForPhoto(
      `🚨 <b>BREAKING:</b> ${escapeHtml(headline)}${context}${links ? `\n\n${links}` : ''}`
    )
    const imageBuffer = await this.cardGenerator.generateBreakingNewsCard(
      headline,
      relatedMarket
    )
    return {
      id: buildId('breaking', `${post.source}:${post.messageId}`),
      type: 'breaking_news',
      priority: 90,
      caption,
      imageBuffer,
      imageUrl: post.imageUrl,
      buttons: buildMarketButtons(relatedMarket),
      sourceId: `${post.source}:${post.messageId}`,
      createdAt: Date.now(),
      market: relatedMarket,
    }
  }

  async composeTrendingMarket(market: MarketData): Promise<QueuedPost> {
    const caption = trimCaptionForPhoto(
      `📊 <b>Trending Market</b>\n\n<b>${escapeHtml(market.question)}</b>\n\n${summarizeOutcomes(market)}\n\n💰 Volume: ${escapeHtml(formatCompactUsd(market.volume24hr || market.volume))}`
    )
    return {
      id: buildId('trending', market.slug),
      type: 'market_spotlight',
      priority: 50,
      caption,
      imageBuffer: await this.cardGenerator.generateMarketCard(market),
      buttons: buildMarketButtons(market),
      sourceId: `market:market_spotlight:${market.slug}:${sourceHour()}`,
      createdAt: Date.now(),
      market,
    }
  }

  async composeTrendingDigest(markets: MarketData[]): Promise<QueuedPost> {
    const top10 = markets.slice(0, 10)

    let caption = '🔥 <b>Trending Markets — Last 24h</b>\n\n'

    top10.forEach((market, index) => {
      const rank = index + 1
      const topOutcomeIdx = market.outcomePrices.indexOf(
        Math.max(...market.outcomePrices)
      )
      const topOutcome = market.outcomes[topOutcomeIdx] || '—'
      const topProb = Math.round(
        (market.outcomePrices[topOutcomeIdx] || 0) * 100
      )
      const vol = formatCompactUsd(market.volume24hr || market.volume)
      const url = buildMarketUrl(market)

      caption += `${rank}. <a href="${url}">${escapeHtml(truncateText(market.question, 110))}</a>\n`
      caption += `    ${escapeHtml(topOutcome)}: <b>${topProb}%</b> · ${escapeHtml(vol)}\n\n`
    })

    caption +=
      '📊 <a href="https://polymarket.com/markets?_s=volume24hr&_od=desc">View all on Polymarket</a>'

    return {
      id: `trending-digest-${sourceHour()}`,
      type: 'trending_digest',
      priority: 95,
      caption: trimCaptionForMessage(caption),
      buttons: [
        {
          text: '🔮 Explore Markets',
          url: 'https://polymarket.com/markets?_s=volume24hr&_od=desc',
        },
        {
          text: config.telegram.communityButtonText,
          url: config.telegram.communityUrl,
        },
      ],
      sourceId: `digest:trending:${new Date().toISOString().slice(0, 10)}`,
      createdAt: Date.now(),
    }
  }

  async composeNewMarket(market: MarketData): Promise<QueuedPost> {
    const caption = trimCaptionForPhoto(
      `🆕 <b>New on Polymarket</b>\n\n<b>${escapeHtml(market.question)}</b>\n\n${summarizeOutcomes(market)}${market.endDate ? `\n\n🗓 Ends: ${escapeHtml(formatDate(market.endDate))}` : ''}`
    )
    return {
      id: buildId('new', market.slug),
      type: 'new_market',
      priority: 60,
      caption,
      imageBuffer: await this.cardGenerator.generateNewMarketCard(market),
      buttons: buildMarketButtons(market),
      sourceId: `market:new_market:${market.slug}:${sourceHour()}`,
      createdAt: Date.now(),
      market,
    }
  }

  async composePriceMover(
    market: MarketData,
    change: number,
    direction: 'up' | 'down'
  ): Promise<QueuedPost> {
    const signed = `${direction === 'up' ? '+' : '-'}${formatPercent(change, 0)}`
    const caption = trimCaptionForPhoto(
      `📈 <b>Market Mover</b> (${escapeHtml(signed)})\n\n<b>${escapeHtml(market.question)}</b>\n\n${summarizeOutcomes(market)}\n\n⚡ Move detected across the leading outcome.`
    )
    const card = await this.cardGenerator.generatePriceMoverCard(
      market,
      change,
      direction
    )
    return {
      id: buildId('mover', `${market.slug}:${signed}`),
      type: 'price_mover',
      priority: change >= 20 ? 80 : 75,
      caption,
      imageBuffer: card,
      buttons: buildMarketButtons(market),
      sourceId: `market:price_mover:${market.slug}:${sourceHour()}`,
      createdAt: Date.now(),
      market,
    }
  }

  async composeResolution(
    market: MarketData,
    resolvedOutcome: string
  ): Promise<QueuedPost> {
    const caption = trimCaptionForMessage(
      `✅ <b>Market Resolved</b>\n\n<b>${escapeHtml(market.question)}</b>\n\nResult: <b>${escapeHtml(resolvedOutcome)}</b>\n\n💰 Final volume: ${escapeHtml(formatCompactUsd(market.volume))}`
    )
    return {
      id: buildId('resolution', `${market.slug}:${resolvedOutcome}`),
      type: 'resolution',
      priority: 70,
      caption,
      imageBuffer: await this.cardGenerator.generateResolutionCard(
        market,
        resolvedOutcome
      ),
      buttons: buildMarketButtons(market),
      sourceId: `market:resolution:${market.slug}`,
      createdAt: Date.now(),
      market,
    }
  }
}
