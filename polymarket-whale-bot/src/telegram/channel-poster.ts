import fs from 'node:fs'
import { Markup, Telegraf } from 'telegraf'
import { CardGenerator } from '../image/card-generator'
import { EnrichedTrade, TelegramConfig } from '../types'
import {
  formatCompactUsd,
  formatMultiplier,
  formatPriceCents,
  formatResolveDate,
  formatSignedUsd,
  formatUsd,
} from '../utils/formatter'
import { logger } from '../utils/logger'
import { getTradeTypeLabel } from '../classifier/trader-classifier'
import {
  TRADER_TYPE_PREMIUM,
  EMOJI_CALENDAR,
  EMOJI_TARGET,
  EMOJI_TRADER,
  EMOJI_MONEYBAG,
  EMOJI_COIN,
  EMOJI_MONEY,
  EMOJI_CHART_UP,
  EMOJI_CHECK,
  EMOJI_FIRE,
  PremiumEmoji,
} from './premium-emojis'

interface CaptionResult {
  text: string
  entities: Array<
    | {
        type: 'custom_emoji'
        offset: number
        length: number
        custom_emoji_id: string
      }
    | {
        type: 'text_link'
        offset: number
        length: number
        url: string
      }
    | {
        type: 'bold'
        offset: number
        length: number
      }
  >
}

class CaptionBuilder {
  private text = ''
  private entities: CaptionResult['entities'] = []

  addPremiumEmoji(emoji: PremiumEmoji, textAfter = ''): this {
    const offset = this.text.length
    const emojiLength = emoji.char.length
    this.text += emoji.char
    this.entities.push({
      type: 'custom_emoji',
      offset,
      length: emojiLength,
      custom_emoji_id: emoji.id,
    })
    if (textAfter) {
      this.text += textAfter
    }
    return this
  }

  addText(text: string): this {
    this.text += text
    return this
  }

  addLink(text: string, url: string): this {
    const offset = this.text.length
    this.text += text
    this.entities.push({
      type: 'text_link',
      offset,
      length: text.length,
      url,
    })
    return this
  }

  addBold(text: string): this {
    const offset = this.text.length
    this.text += text
    this.entities.push({
      type: 'bold',
      offset,
      length: text.length,
    })
    return this
  }

  newLine(): this {
    this.text += '\n'
    return this
  }

  build(): CaptionResult {
    const trimmed = this.text.slice(0, 1024)
    const entities = this.entities.filter(
      (entity) => entity.offset + entity.length <= trimmed.length
    )
    return { text: trimmed, entities }
  }
}

export class ChannelPoster {
  private readonly bot: Telegraf
  private readonly cardGenerator = new CardGenerator()
  private readonly dryRun = process.env.TELEGRAM_DRY_RUN === '1'
  private launched = false

  constructor(private readonly config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken)
  }

  async launch(): Promise<void> {
    if (this.launched) {
      return
    }
    if (this.dryRun) {
      this.launched = true
      logger.info('Telegram dry-run mode enabled')
      return
    }
    const botInfo = await this.bot.telegram.getMe()
    logger.info(`Bot verified: @${botInfo.username} (${botInfo.id})`)
    this.launched = true
    logger.info(`Telegram posting target: ${this.config.channelId}`)
  }

  stop(reason = 'shutdown'): void {
    if (this.launched) {
      this.launched = false
    }
  }

  getCardGenerator(): CardGenerator {
    return this.cardGenerator
  }

  async writeSampleOutput(
    trade: EnrichedTrade,
    outputPath: string
  ): Promise<void> {
    const { text, entities } = this.buildCaption(trade)
    const output = `${text}\n\n--- ENTITIES ---\n${JSON.stringify(entities, null, 2)}`
    await fs.promises.writeFile(outputPath, output)
  }

  async postAlert(trade: EnrichedTrade): Promise<void> {
    if (this.dryRun) {
      logger.info(`Dry-run alert: ${trade.trade.title} - $${trade.trade.usdcSize}`)
      return
    }
    const { text, entities } = this.buildCaption(trade)
    const keyboard = this.buildKeyboard(trade)
    const image = await this.cardGenerator.generateCard(trade)

    try {
      if (image) {
        await this.bot.telegram.sendPhoto(
          this.config.channelId,
          { source: image },
          {
            caption: text,
            caption_entities: entities,
            reply_markup: keyboard.reply_markup,
          } as any
        )
        return
      }

      await this.bot.telegram.sendMessage(this.config.channelId, text, {
        entities,
        reply_markup: keyboard.reply_markup,
        link_preview_options: { is_disabled: true },
      } as any)
    } catch (error: any) {
      const errorMsg = String(error?.message || error)
      if (
        errorMsg.includes('CUSTOM_EMOJI') ||
        errorMsg.includes('custom emoji') ||
        errorMsg.includes('premium')
      ) {
        logger.warn(
          'Premium custom emoji not supported, falling back to standard emoji'
        )
        if (image) {
          await this.bot.telegram.sendPhoto(
            this.config.channelId,
            { source: image },
            { caption: text, reply_markup: keyboard.reply_markup }
          )
        } else {
          await this.bot.telegram.sendMessage(this.config.channelId, text, {
            reply_markup: keyboard.reply_markup,
            link_preview_options: { is_disabled: true },
          })
        }
        return
      }
      throw error
    }
  }

  private buildKeyboard(trade: EnrichedTrade) {
    const eventSlug =
      trade.marketInfo.eventSlug ||
      trade.trade.eventSlug ||
      trade.marketInfo.slug ||
      trade.trade.slug
    return Markup.inlineKeyboard([
      [
        Markup.button.url(
          this.config.referralButtonText,
          this.config.referralUrl
        ),
      ],
      [
        Markup.button.url(
          '📊 View Polymarket',
          `https://polymarket.com/event/${eventSlug}`
        ),
      ],
    ])
  }

  private buildCaption(trade: EnrichedTrade): CaptionResult {
    const typeEmoji = TRADER_TYPE_PREMIUM[trade.primaryType]
    const dynamicLabel = getTradeTypeLabel(trade.primaryType, trade.trade.side)
    const displayName =
      trade.trade.name ||
      trade.trade.pseudonym ||
      trade.trade.proxyWallet.slice(0, 10)
    const side = trade.trade.side === 'BUY' ? 'Buy' : 'Sell'
    const question = trade.marketInfo.question || trade.trade.title
    const outcome = trade.trade.outcome || String(trade.trade.outcomeIndex)
    const eventSlug =
      trade.marketInfo.eventSlug ||
      trade.trade.eventSlug ||
      trade.marketInfo.slug ||
      trade.trade.slug
    const marketUrl = `https://polymarket.com/event/${eventSlug}`

    const builder = new CaptionBuilder()

    builder.addPremiumEmoji(typeEmoji, ` ${dynamicLabel}`)
    if (trade.isFreshWallet) {
      builder.addText(' | 🆕 Fresh Wallet Detected')
    }
    builder.newLine().newLine()
    builder.addLink(question, marketUrl)
    builder.newLine()
    if (trade.marketInfo.volume > 0) {
      builder.addText(`Vol: ${formatCompactUsd(trade.marketInfo.volume)}`)
      builder.newLine()
    }
    builder.addPremiumEmoji(
      EMOJI_CALENDAR,
      ` Resolves: ${formatResolveDate(trade.marketInfo.endDate)}`
    )
    builder.newLine()
    if (trade.holderStats.topHoldersOnSide > 0) {
      builder.addText(
        `👥 Top holders: ${trade.holderStats.topHoldersOnSide}/${trade.holderStats.totalTopHolders} ${trade.holderStats.side}`
      )
      builder.newLine()
    }
    builder.addText(`⚠️ Risk ${trade.risk.emoji}`)
    builder.newLine().newLine()
    builder.addPremiumEmoji(EMOJI_TARGET, ` ${side} ${outcome}`)
    builder.newLine()
    builder.addText('├ ')
    const amountStr = formatUsd(trade.trade.usdcSize)
    if (trade.trade.usdcSize >= 50000) {
      builder.addPremiumEmoji(EMOJI_MONEYBAG, ' Amount: ')
      builder.addBold(amountStr)
    } else {
      builder.addPremiumEmoji(EMOJI_MONEYBAG, ` Amount: ${amountStr}`)
    }
    builder.newLine()
    builder.addText('├ ')
    let priceText = ` Price: ${formatPriceCents(trade.trade.price)}`
    if (
      trade.priceMomentum &&
      Math.abs(trade.priceMomentum.changePercent) >= 10 &&
      trade.priceMomentum.direction !== 'flat'
    ) {
      const arrow = trade.priceMomentum.direction === 'up' ? '↑' : '↓'
      priceText += ` | ${arrow}${Math.abs(trade.priceMomentum.changePercent)}% ${trade.priceMomentum.periodLabel}`
    }
    builder.addPremiumEmoji(EMOJI_COIN, priceText)
    builder.newLine()
    builder.addText('└ ')
    builder.addPremiumEmoji(
      EMOJI_MONEY,
      ` To win: ${formatUsd(trade.potentialWin)} (${formatMultiplier(trade.multiplier)})`
    )
    builder.newLine().newLine()
    builder.addPremiumEmoji(EMOJI_TRADER, ' Trader: ')
    builder.addLink(
      displayName,
      `https://polymarket.com/profile/${trade.trade.proxyWallet}`
    )
    if (trade.xUsername) {
      builder.addText(' · ')
      builder.addLink('𝕏', `https://x.com/${trade.xUsername}`)
    }
    builder.addText(' · ')
    builder.addLink('Copy Trade', this.config.referralUrl)
    builder.newLine()

    const traderLines: Array<{ emoji: PremiumEmoji | null; text: string }> = []
    traderLines.push({
      emoji: EMOJI_CHART_UP,
      text: ` Positions: ${formatCompactUsd(trade.traderStats.totalPositionsValue)} · ${trade.traderStats.closedPositions} bets`,
    })
    if (trade.traderStats.closedPositions >= 3) {
      traderLines.push({
        emoji: EMOJI_CHECK,
        text: ` Win Rate: ${Math.round(trade.traderStats.winRate)}%`,
      })
    }
    traderLines.push({
      emoji: EMOJI_MONEY,
      text: ` P&L: ${formatSignedUsd(trade.traderStats.totalRealizedPnl)}`,
    })
    if (trade.hashdiveProfile && trade.hashdiveProfile.totalVolumeUsd > 0) {
      traderLines.push({
        emoji: EMOJI_COIN,
        text: ` Volume: ${formatCompactUsd(trade.hashdiveProfile.totalVolumeUsd)}`,
      })
    }
    if (trade.traderStats.bestWinAmount && trade.traderStats.bestWinAmount > 0) {
      traderLines.push({
        emoji: EMOJI_MONEYBAG,
        text: ` Best Win: ${formatSignedUsd(trade.traderStats.bestWinAmount)}`,
      })
    }
    if (trade.holderStats.traderIsTopHolder && trade.holderStats.traderHolderRank) {
      traderLines.push({
        emoji: null,
        text: `👑 #${trade.holderStats.traderHolderRank} Top Holder`,
      })
    }
    if (trade.topCategory) {
      traderLines.push({ emoji: null, text: `🏷️ Top Category: ${trade.topCategory}` })
    }
    for (const [index, line] of traderLines.entries()) {
      builder.addText(index === traderLines.length - 1 ? '└ ' : '├ ')
      if (line.emoji) {
        builder.addPremiumEmoji(line.emoji, line.text)
      } else {
        builder.addText(line.text)
      }
      builder.newLine()
    }

    interface SignalEntry {
      priority: number
      text: string
    }

    const signals: SignalEntry[] = []

    if (trade.coordinationSignal?.isCoordinated) {
      signals.push({
        priority: 100,
        text: `🧠 Multi-Wallet: ${trade.coordinationSignal.walletsOnSameSide} wallets ${trade.trade.side === 'BUY' ? 'buying' : 'selling'} same side (${formatCompactUsd(trade.coordinationSignal.totalAmount)} total)`,
      })
    }

    if (trade.newsCorrelation?.hasRecentNews && trade.newsCorrelation.articles[0]) {
      const article = trade.newsCorrelation.articles[0]
      const headline =
        article.title.length > 55
          ? `${article.title.slice(0, 55)}…`
          : article.title
      signals.push({
        priority: 90,
        text: `📰 "${headline}" — ${article.minutesAgo < 60 ? `${article.minutesAgo}min ago` : `${Math.round(article.minutesAgo / 60)}h ago`}`,
      })
    }

    if (trade.capitalInflow?.hasRecentInflow) {
      signals.push({
        priority: 80,
        text: `💸 +${formatCompactUsd(trade.capitalInflow.totalInflow)} USDC inflow detected (last 24h)`,
      })
    }

    if (trade.unusualScore && trade.unusualScore.score >= 40 && trade.unusualScore.signals[0]) {
      signals.push({
        priority: 70,
        text: `⚠️ ${trade.unusualScore.signals[0]}`,
      })
    }

    if (trade.pressureSignal?.isHighPressure) {
      const pctLabel =
        trade.pressureSignal.dominancePercent >= 80 ? 'Aggressive' : 'Strong'
      const dir = trade.trade.side === 'BUY' ? 'Buy' : 'Sell'
      signals.push({
        priority: 60,
        text: `⚠️ ${pctLabel} ${dir} Pressure`,
      })
    }

    if (trade.walletPattern?.isRepeatTrader) {
      signals.push({
        priority: 50,
        text: `🔄 Repeat trader: ${trade.walletPattern.recentFrequency.toFixed(1)} trades/day`,
      })
    }

    if (trade.insiderScore && trade.insiderScore.score >= 50) {
      const topSignal = trade.insiderScore.signals[0] || ''
      signals.push({
        priority: 40,
        text: `🎯 Score: ${trade.insiderScore.score}/100 — ${topSignal}`,
      })
    }

    signals.sort((a, b) => b.priority - a.priority)
    for (const signal of signals.slice(0, 2)) {
      builder.newLine()
      builder.addText(signal.text)
    }

    const marketIntelligenceParts: string[] = []
    if (trade.holderStats.whalesInMarket > 0) {
      marketIntelligenceParts.push(
        `🐋 ${trade.holderStats.whalesInMarket} ${trade.holderStats.whalesInMarket === 1 ? 'Whale' : 'Whales'}`
      )
    }
    if (trade.holderStats.insidersInMarket > 0) {
      marketIntelligenceParts.push(
        `🕵️ ${trade.holderStats.insidersInMarket} ${trade.holderStats.insidersInMarket === 1 ? 'Insider' : 'Insiders'}`
      )
    }
    if (trade.freshWalletsInMarket > 0) {
      marketIntelligenceParts.push(`🆕 ${trade.freshWalletsInMarket} Fresh`)
    }
    if (marketIntelligenceParts.length > 0) {
      builder.newLine()
      builder.addText(marketIntelligenceParts.join(' · '))
    }

    return builder.build()
  }
}
