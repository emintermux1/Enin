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
import { formatEmojiPrefix } from '../utils/emoji-tagger'

function sourceHour(): string {
  return new Date().toISOString().slice(0, 13)
}

function buildMarketUrl(market?: MarketData): string {
  const marketPath = market?.eventSlug || market?.slug
  return marketPath
    ? `https://polymarket.com/event/${marketPath}`
    : 'https://polymarket.com'
}

function buildMarketButtons(
  market?: MarketData,
  fallbackUrl?: string
): InlineButton[] {
  const marketUrl = buildMarketUrl(market)
  const finalUrl =
    marketUrl !== 'https://polymarket.com'
      ? marketUrl
      : fallbackUrl || 'https://polymarket.com'
  const hasSpecificUrl = finalUrl !== 'https://polymarket.com'
  return [
    {
      text: hasSpecificUrl ? '🔮 Trade on Polymarket' : '🔮 Open Polymarket',
      url: finalUrl,
    },
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
    const polymarketLink = post.links.find((link) =>
      link.url.includes('polymarket.com')
    )
    const fallbackUrl = polymarketLink?.url
      ? polymarketLink.url.split('?')[0]
      : undefined
    const cleanedText = post.text.replace(/\s+/g, ' ').trim()
    if (post.source === 'polymarket_markets') {
      if (cleanedText.length < 20 || isSpamMarket(cleanedText)) {
        return null
      }
      if (relatedMarket) {
        const caption = trimCaptionForPhoto(
          `${formatEmojiPrefix(relatedMarket)}🆕 <b>New on Polymarket</b>\n\n<b>${escapeHtml(relatedMarket.question)}</b>\n\n${summarizeOutcomes(relatedMarket)}${relatedMarket.endDate ? `\n\n🗓 Ends: ${escapeHtml(formatDate(relatedMarket.endDate))}` : ''}`
        )
        return {
          id: buildId('scraped-new', `${post.source}:${post.messageId}`),
          type: 'new_market',
          priority: 85,
          caption,
          imageUrl: relatedMarket.image || post.imageUrl,
          buttons: buildMarketButtons(relatedMarket, fallbackUrl),
          sourceId: `${post.source}:${post.messageId}`,
          createdAt: Date.now(),
          market: relatedMarket,
        }
      }
    }

    const headline = truncateText(cleanedText, 220)
    const emojiPrefix = relatedMarket
      ? formatEmojiPrefix(relatedMarket)
      : formatEmojiPrefix({ question: headline, tags: [] })
    const context = relatedMarket
      ? `\n\n<b>Related market:</b> ${escapeHtml(relatedMarket.question)}\n${summarizeOutcomes(relatedMarket)}`
      : ''
    const caption = trimCaptionForPhoto(
      `${emojiPrefix}🚨 <b>BREAKING:</b> ${escapeHtml(headline)}${context}`
    )
    return {
      id: buildId('breaking', `${post.source}:${post.messageId}`),
      type: 'breaking_news',
      priority: 90,
      caption,
      imageUrl: relatedMarket?.image || post.imageUrl,
      buttons: buildMarketButtons(relatedMarket, fallbackUrl),
      sourceId: `${post.source}:${post.messageId}`,
      createdAt: Date.now(),
      market: relatedMarket,
    }
  }

  async composeTrendingMarket(market: MarketData): Promise<QueuedPost> {
    const caption = trimCaptionForPhoto(
      `${formatEmojiPrefix(market)}📊 <b>Trending Market</b>\n\n<b>${escapeHtml(market.question)}</b>\n\n${summarizeOutcomes(market)}\n\n💰 Volume: ${escapeHtml(formatCompactUsd(market.volume24hr || market.volume))}`
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
      const emojiPrefix = formatEmojiPrefix(market)

      caption += `${rank}. ${emojiPrefix}<a href="${url}">${escapeHtml(truncateText(market.question, 100))}</a>\n`
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
          text: '🔮 Open on Polymarket',
          url: 'https://polymarket.com/markets?_s=volume24hr&_od=desc',
        },
        {
          text: config.telegram.communityButtonText,
          url: config.telegram.communityUrl,
        },
      ],
      sourceId: `digest:trending:${sourceHour()}`,
      createdAt: Date.now(),
    }
  }

  async composeNewMarket(market: MarketData): Promise<QueuedPost> {
    const caption = trimCaptionForPhoto(
      `${formatEmojiPrefix(market)}🆕 <b>New on Polymarket</b>\n\n<b>${escapeHtml(market.question)}</b>\n\n${summarizeOutcomes(market)}${market.endDate ? `\n\n🗓 Ends: ${escapeHtml(formatDate(market.endDate))}` : ''}`
    )
    return {
      id: buildId('new', market.slug),
      type: 'new_market',
      priority: 85,
      caption,
      imageUrl: market.image || undefined,
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
      `${formatEmojiPrefix(market)}📈 <b>Market Mover</b> (${escapeHtml(signed)})\n\n<b>${escapeHtml(market.question)}</b>\n\n${summarizeOutcomes(market)}\n\n⚡ Move detected across the leading outcome.`
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

  async composeFlashAlert(
    market: MarketData,
    change: number,
    direction: 'up' | 'down'
  ): Promise<QueuedPost> {
    const arrow = direction === 'up' ? '🚀' : '💥'
    const signed = `${direction === 'up' ? '+' : '-'}${formatPercent(change, 0)}`
    const caption = trimCaptionForPhoto(
      `⚡ <b>FLASH ALERT</b> (${escapeHtml(signed)})\n\n${arrow} <b>${escapeHtml(market.question)}</b>\n\n${summarizeOutcomes(market)}\n\n🔥 Massive ${escapeHtml(signed)} swing detected!`
    )
    const card = await this.cardGenerator.generateFlashAlertCard(
      market,
      change,
      direction
    )
    return {
      id: buildId('flash', `${market.slug}:${signed}`),
      type: 'flash_alert',
      priority: 92,
      caption,
      imageBuffer: card,
      buttons: buildMarketButtons(market),
      sourceId: `market:flash_alert:${market.slug}:${sourceHour()}`,
      createdAt: Date.now(),
      market,
    }
  }

  async composeResolution(
    market: MarketData,
    resolvedOutcome: string
  ): Promise<QueuedPost> {
    const emojiPrefix = formatEmojiPrefix(market)
    const caption = trimCaptionForPhoto(
      `${emojiPrefix}✅ <b>MARKET RESOLVED</b>\n\n<b>${escapeHtml(market.question)}</b>\n\n🏆 Winner: <b>${escapeHtml(resolvedOutcome)}</b>\n\n💰 Total Volume: ${escapeHtml(formatCompactUsd(market.volume))}${market.endDate ? `\n📅 Closed: ${escapeHtml(formatDate(market.endDate))}` : ''}`
    )
    const hasMarketImage = market.image && market.image.length > 0
    return {
      id: buildId('resolution', `${market.slug}:${resolvedOutcome}`),
      type: 'resolution',
      priority: 75,
      caption,
      imageBuffer: hasMarketImage
        ? undefined
        : await this.cardGenerator.generateResolutionCard(
            market,
            resolvedOutcome
          ),
      imageUrl: hasMarketImage ? market.image : undefined,
      buttons: buildMarketButtons(market),
      sourceId: `market:resolution:${market.slug}`,
      createdAt: Date.now(),
      market,
    }
  }
}
