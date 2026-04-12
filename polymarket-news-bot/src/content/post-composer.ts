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

function buildMarketButtons(market?: MarketData): InlineButton[] {
  if (market?.eventSlug) {
    return [
      {
        text: '🔮 Trade on Polymarket',
        url: `https://polymarket.com/event/${market.eventSlug}`,
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

export class PostComposer {
  constructor(private readonly cardGenerator: MarketCardGenerator) {}

  async composeFromScraped(
    post: ScrapedPost,
    relatedMarket?: MarketData
  ): Promise<QueuedPost> {
    const headline = truncateText(post.text.replace(/\s+/g, ' ').trim(), 220)
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
