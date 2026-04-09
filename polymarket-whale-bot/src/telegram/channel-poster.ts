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
import { TRADER_TYPE_META } from '../classifier/trader-classifier'
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
    const typeMeta = TRADER_TYPE_META[trade.primaryType]
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

    builder.addPremiumEmoji(typeEmoji, ` ${typeMeta.label}`)
    if (trade.isFreshWallet) {
      builder.addText(' | 🆕 Fresh Wallet Detected')
    }
    builder.newLine().newLine()
    builder.addPremiumEmoji(EMOJI_CHART_UP, ' ')
    builder.addLink(question, marketUrl)
    if (trade.marketInfo.volume > 0 || trade.marketInfo.liquidity > 0) {
      const marketContextParts = [
        `Vol: ${formatCompactUsd(trade.marketInfo.volume)}`,
        `Liq: ${formatCompactUsd(trade.marketInfo.liquidity)}`,
        ...trade.marketInfo.tags.filter(Boolean).slice(0, 2),
      ]
      builder.newLine()
      builder.addPremiumEmoji(EMOJI_MONEY, ` ${marketContextParts.join(' · ')}`)
      builder.newLine()
    }
    builder.newLine()
    builder.addPremiumEmoji(
      EMOJI_CALENDAR,
      ` Resolves: ${formatResolveDate(trade.marketInfo.endDate)}`
    )
    builder.newLine()
    builder.addText(`⚠️ Risk ${trade.risk.emoji}`)
    builder.newLine().newLine()
    builder.addPremiumEmoji(EMOJI_TARGET, ` ${side} ${outcome}`)
    builder.newLine()
    builder.addText('├ ')
    builder.addPremiumEmoji(
      EMOJI_MONEYBAG,
      ` Amount: ${formatUsd(trade.trade.usdcSize)}`
    )
    builder.newLine()
    builder.addText('├ ')
    builder.addPremiumEmoji(
      EMOJI_COIN,
      ` Price: ${formatPriceCents(trade.trade.price)}`
    )
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
    const streak =
      trade.traderStats.bestWinStreak || trade.traderStats.currentStreak
    if (streak && streak >= 2) {
      traderLines.push({
        emoji: EMOJI_FIRE,
        text: ` Last Streak: ${streak}W`,
      })
    }
    if (trade.holderStats.traderIsTopHolder) {
      traderLines.push({
        emoji: null,
        text: `👑 Top ${trade.holderStats.topHoldersOnSide}/${trade.holderStats.totalTopHolders} Holder`,
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

    const marketIntelligenceParts: string[] = []
    if (trade.holderStats.whalesInMarket > 0) {
      const whaleWord =
        trade.holderStats.whalesInMarket === 1 ? 'Whale' : 'Whales'
      marketIntelligenceParts.push(
        `🐋 ${trade.holderStats.whalesInMarket} ${whaleWord}`
      )
    }
    if (trade.holderStats.insidersInMarket > 0) {
      const insiderWord =
        trade.holderStats.insidersInMarket === 1 ? 'Insider' : 'Insiders'
      marketIntelligenceParts.push(
        `🕵️ ${trade.holderStats.insidersInMarket} ${insiderWord}`
      )
    }
    if (trade.freshWalletsInMarket > 0) {
      marketIntelligenceParts.push(`🆕 ${trade.freshWalletsInMarket} Fresh`)
    }
    if (marketIntelligenceParts.length > 0) {
      builder.newLine()
      builder.addText(marketIntelligenceParts.join(' · '))
    }

    if (trade.insiderScore && trade.insiderScore.score >= 50) {
      builder.newLine()
      const topSignals = trade.insiderScore.signals.slice(0, 2).join(' · ')
      builder.addText(`🎯 Score: ${trade.insiderScore.score}/100 — ${topSignals}`)
    }

    if (trade.unusualScore && trade.unusualScore.score >= 40) {
      builder.newLine()
      builder.addText(`⚠️ Unusual: ${trade.unusualScore.signals[0] || ''}`)
    }

    return builder.build()
  }
}
