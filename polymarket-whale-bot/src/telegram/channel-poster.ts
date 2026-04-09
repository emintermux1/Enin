import fs from 'node:fs'
import { Markup, Telegraf } from 'telegraf'
import { CardGenerator } from '../image/card-generator'
import {
  EnrichedTrade,
  LeaderboardTrader,
  ResolutionAlert,
  TelegramConfig,
  TraderType,
} from '../types'
import {
  formatCompactUsd,
  formatMultiplier,
  formatPriceCents,
  formatResolveDate,
  formatSignedCompactUsd,
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

function formatCalledAgo(daysAgo: number): string {
  if (daysAgo <= 0) {
    return 'today'
  }
  if (daysAgo === 1) {
    return '1 day ago'
  }
  return `${daysAgo} days ago`
}

function toTraderType(value: string): TraderType {
  if (value === 'INSIDER' || value === 'SMART_MONEY' || value === 'TOP_HOLDER' || value === 'CONVICTION_BUILD') {
    return value
  }
  return 'WHALE'
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
    const image = await this.cardGenerator.generateCard(trade)
    await this.sendPost({
      text,
      entities,
      image,
      eventSlug:
        trade.marketInfo.eventSlug ||
        trade.trade.eventSlug ||
        trade.marketInfo.slug ||
        trade.trade.slug,
    })
  }

  async postResolutionCard(alert: ResolutionAlert): Promise<void> {
    if (this.dryRun) {
      logger.info(`Dry-run resolution card: ${alert.marketQuestion} - ${formatSignedUsd(alert.pnl)}`)
      return
    }
    const { text, entities } = this.buildResolutionCaption(alert)
    const image = await this.cardGenerator.generatePnlCard(alert)
    await this.sendPost({
      text,
      entities,
      image,
      eventSlug: alert.marketSlug,
    })
  }

  async postLeaderboard(
    winners: LeaderboardTrader[],
    losers: LeaderboardTrader[]
  ): Promise<number> {
    const { text, entities } = this.buildLeaderboardCaption(winners, losers)

    if (this.dryRun) {
      logger.info(`Dry-run leaderboard post:\n${text}`)
      return 1
    }

    const card = await this.cardGenerator.generateLeaderboardCard()
    let messageId: number
    if (card) {
      const result = await this.bot.telegram.sendPhoto(
        this.config.channelId,
        { source: card },
        { caption: text, caption_entities: entities } as any
      )
      messageId = result.message_id
    } else {
      const result = await this.bot.telegram.sendMessage(this.config.channelId, text, {
        entities,
        link_preview_options: { is_disabled: true },
      } as any)
      messageId = result.message_id
    }

    await this.bot.telegram.pinChatMessage(this.config.channelId, messageId, {
      disable_notification: true,
    })

    return messageId
  }

  async postHeatmap(
    markets: Array<{
      marketQuestion: string
      tradeCount: number
      totalVolume: number
      uniqueWallets: number
    }>
  ): Promise<void> {
    const builder = new CaptionBuilder()
    builder.addText('🔥 MARKET HEATMAP — Last 12h\n')
    builder.addText('━━━━━━━━━━━━━━━━━\n')

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']

    for (const [i, market] of markets.entries()) {
      const medal = medals[i] || `${i + 1}.`
      const volLabel = formatCompactUsd(Number(market.totalVolume || 0))

      builder.addText(`${medal} `)
      builder.addBold(
        market.marketQuestion.length > 40
          ? `${market.marketQuestion.slice(0, 40)}…`
          : market.marketQuestion
      )
      builder.newLine()
      builder.addText(
        `   ${market.tradeCount} trades · ${volLabel} vol · ${market.uniqueWallets} whales`
      )
      builder.newLine()
    }

    builder.newLine()
    builder.addText(
      `🕐 Updated: ${new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      })} UTC`
    )

    const { text, entities } = builder.build()

    if (this.dryRun) {
      logger.info(`Dry-run heatmap post:\n${text}`)
      return
    }

    await this.bot.telegram.sendMessage(this.config.channelId, text, {
      entities,
      link_preview_options: { is_disabled: true },
    } as any)
  }

  async editLeaderboard(
    messageId: number,
    winners: LeaderboardTrader[],
    losers: LeaderboardTrader[]
  ): Promise<void> {
    const { text, entities } = this.buildLeaderboardCaption(winners, losers)

    if (this.dryRun) {
      logger.info(`Dry-run leaderboard edit (${messageId}):\n${text}`)
      return
    }

    try {
      await this.bot.telegram.editMessageCaption(
        this.config.channelId,
        messageId,
        undefined,
        text,
        { caption_entities: entities } as any
      )
    } catch (error: any) {
      const errorMessage = String(error?.message || error)
      if (errorMessage.includes('message is not modified')) {
        return
      }
      if (errorMessage.includes('there is no caption in the message to edit')) {
        await this.bot.telegram.editMessageText(this.config.channelId, messageId, undefined, text, {
          entities,
          link_preview_options: { is_disabled: true },
        } as any)
        return
      }
      throw error
    }
  }

  private async sendPost(params: {
    text: string
    entities: CaptionResult['entities']
    image: Buffer | null
    eventSlug: string
  }): Promise<void> {
    const keyboard = this.buildMarketKeyboard(params.eventSlug)

    try {
      if (params.image) {
        await this.bot.telegram.sendPhoto(
          this.config.channelId,
          { source: params.image },
          {
            caption: params.text,
            caption_entities: params.entities,
            reply_markup: keyboard.reply_markup,
          } as any
        )
        return
      }

      await this.bot.telegram.sendMessage(this.config.channelId, params.text, {
        entities: params.entities,
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
        if (params.image) {
          await this.bot.telegram.sendPhoto(
            this.config.channelId,
            { source: params.image },
            { caption: params.text, reply_markup: keyboard.reply_markup }
          )
        } else {
          await this.bot.telegram.sendMessage(this.config.channelId, params.text, {
            reply_markup: keyboard.reply_markup,
            link_preview_options: { is_disabled: true },
          })
        }
        return
      }
      throw error
    }
  }

  private buildMarketKeyboard(eventSlug: string) {
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
    const dynamicLabel = getTradeTypeLabel(
      trade.primaryType,
      trade.trade.side,
      trade.isFreshWallet,
      trade.risk.level
    )
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

    if (typeEmoji) {
      builder.addPremiumEmoji(typeEmoji, ` ${dynamicLabel}`)
    } else {
      builder.addText(dynamicLabel)
    }
    builder.newLine().newLine()
    builder.addLink(question, marketUrl)
    if (trade.marketInfo.volume > 0) {
      builder.addText(` · Vol: ${formatCompactUsd(trade.marketInfo.volume)}`)
    }
    builder.newLine().newLine()
    builder.addPremiumEmoji(
      EMOJI_CALENDAR,
      ` Resolves: ${formatResolveDate(trade.marketInfo.endDate)}`
    )
    builder.newLine()
    if (trade.holderStats.topHoldersOnSide > 0 || trade.holderStats.oppositeSideHolders > 0) {
      builder.newLine()
      builder.addText(
        `👥 Top Holders: ${trade.holderStats.topHoldersOnSide}/20 ${trade.holderStats.side} · ${trade.holderStats.oppositeSideHolders}/20 ${trade.holderStats.oppositeSide}`
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
      builder.addText('Amount: ')
      builder.addBold(amountStr)
    } else {
      builder.addText(`Amount: ${amountStr}`)
    }
    builder.newLine()
    builder.addText('├ ')
    let priceText = `Price: ${formatPriceCents(trade.trade.price)}`
    if (
      trade.priceMomentum &&
      Math.abs(trade.priceMomentum.changePercent) >= 10 &&
      trade.priceMomentum.direction !== 'flat'
    ) {
      const arrow = trade.priceMomentum.direction === 'up' ? '↑' : '↓'
      priceText += ` | ${arrow}${Math.abs(trade.priceMomentum.changePercent)}% ${trade.priceMomentum.periodLabel}`
    }
    builder.addText(priceText)
    builder.newLine()
    builder.addText('└ ')
    builder.addText(
      `To win: ${formatUsd(trade.potentialWin)} (${formatMultiplier(trade.multiplier)})`
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
      emoji: null,
      text: `Positions: ${formatCompactUsd(trade.traderStats.totalPositionsValue)} · ${trade.traderStats.livePositions} live · ${trade.traderStats.closedPositions} closed`,
    })
    if (trade.traderStats.closedPositions >= 3) {
      traderLines.push({
        emoji: null,
        text: `Win Rate: ${Math.round(trade.traderStats.winRate)}%`,
      })
    }
    traderLines.push({
      emoji: null,
      text: `P&L: ${formatSignedUsd(trade.traderStats.totalRealizedPnl)}`,
    })
    if (trade.hashdiveProfile && trade.hashdiveProfile.totalVolumeUsd > 0) {
      traderLines.push({
        emoji: null,
        text: `Volume: ${formatCompactUsd(trade.hashdiveProfile.totalVolumeUsd)}`,
      })
    }
    if (trade.traderStats.bestWinAmount && trade.traderStats.bestWinAmount > 0) {
      traderLines.push({
        emoji: null,
        text: `Best Win: ${formatSignedUsd(trade.traderStats.bestWinAmount)}`,
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
      url?: string
      linkText?: string
      suffix?: string
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
      const timeAgo =
        article.minutesAgo < 60
          ? `${article.minutesAgo}min ago`
          : `${Math.round(article.minutesAgo / 60)}h ago`
      signals.push({
        priority: 90,
        text: `📰 "${headline}" — ${timeAgo}`,
        url: article.url || undefined,
        linkText: headline,
        suffix: ` — ${timeAgo}`,
      })
    }

    if (trade.preNewsSignal?.hasPostTradeNews) {
      signals.push({
        priority: 95,
        text: `⏰ Pre-news trade: positioned ${trade.preNewsSignal.minutesBeforeNews}min before ${trade.preNewsSignal.newsSource} reported`,
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

    if (trade.pressureSignal?.isHighPressure && trade.trade.usdcSize >= 50_000) {
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

    if (trade.cumulativeInsiderProfile?.isSuspectedInsider) {
      signals.push({
        priority: 45,
        text: `🔍 Known insider pattern: ${trade.cumulativeInsiderProfile.preNewsCount}x pre-news trades`,
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
      if (signal.url) {
        builder.addText('📰 ')
        builder.addLink(signal.linkText!, signal.url)
        builder.addText(signal.suffix!)
      } else {
        builder.addText(signal.text)
      }
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

  private buildResolutionCaption(alert: ResolutionAlert): CaptionResult {
    const builder = new CaptionBuilder()
    const traderType = toTraderType(alert.primaryType)
    const originalLabel = getTradeTypeLabel(traderType, 'BUY')
    const marketUrl = `https://polymarket.com/event/${alert.marketSlug}`
    const traderUrl = `https://polymarket.com/profile/${alert.traderWallet}`
    const marketIntelligenceParts: string[] = []

    if (alert.whalesInMarket > 0) {
      marketIntelligenceParts.push(
        `🐋 ${alert.whalesInMarket} ${alert.whalesInMarket === 1 ? 'Whale' : 'Whales'}`
      )
    }
    if (alert.insidersInMarket > 0) {
      marketIntelligenceParts.push(
        `🕵️ ${alert.insidersInMarket} ${alert.insidersInMarket === 1 ? 'Insider' : 'Insiders'}`
      )
    }
    if (alert.freshWalletsInMarket > 0) {
      marketIntelligenceParts.push(`🆕 ${alert.freshWalletsInMarket} Fresh`)
    }

    builder.addPremiumEmoji(EMOJI_CHECK, ' Market Resolved — ')
    builder.addBold(alert.pnl >= 0 ? 'PROFIT' : 'LOSS')
    builder.newLine().newLine()

    builder.addPremiumEmoji(EMOJI_CHART_UP, ' ')
    builder.addLink(alert.marketQuestion, marketUrl)
    builder.addText(` → ${alert.outcome} ${alert.won ? '✅' : '❌'}`)
    builder.newLine()
    builder.addText(`Resolved: ${formatResolveDate(alert.resolvedAt)}`)
    builder.newLine().newLine()

    builder.addPremiumEmoji(EMOJI_MONEYBAG, ` PnL: ${formatSignedUsd(alert.pnl)}`)
    builder.newLine()
    builder.addText(`├ Entry: ${formatUsd(alert.entryAmount)} at ${formatPriceCents(alert.entryPrice)}`)
    builder.newLine()
    builder.addText(`├ Shares: ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(alert.shares)}`)
    builder.newLine()
    builder.addText(`└ Payout: ${formatMultiplier(alert.multiplier)}`)
    builder.newLine().newLine()

    builder.addPremiumEmoji(EMOJI_TRADER, ' Trader: ')
    builder.addLink(alert.traderName, traderUrl)
    builder.addText(' · ')
    builder.addLink('Copy Trade', this.config.referralUrl)
    builder.newLine()
    builder.addText(`├ Called ${formatCalledAgo(alert.daysAgo)}`)
    builder.newLine()
    builder.addText(`└ Original: ${alert.originalAlertLabel || originalLabel}`)

    if (marketIntelligenceParts.length > 0) {
      builder.newLine().newLine()
      builder.addText(marketIntelligenceParts.join(' · '))
    }

    return builder.build()
  }

  private buildLeaderboardCaption(
    winners: LeaderboardTrader[],
    losers: LeaderboardTrader[]
  ): CaptionResult {
    const builder = new CaptionBuilder()
    const rankEmojis = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

    builder.addText('🐋 TOP WHALES & INSIDERS TODAY 🏆')
    builder.newLine().newLine()

    for (const trader of winners) {
      const emoji = rankEmojis[trader.rank - 1] || `${trader.rank}.`
      builder.addText(`${emoji} `)
      builder.addLink(trader.name, `https://polymarket.com/profile/${trader.wallet}`)
      if (trader.xUsername) {
        builder.addText(' · ')
        builder.addLink('𝕏', `https://x.com/${trader.xUsername}`)
      }
      builder.addText(
        ` ${formatSignedCompactUsd(trader.pnl)} | Wins: ${trader.wins}/${trader.totalBets} | ${trader.livePositions} live`
      )
      builder.newLine()
    }

    if (losers.length > 0) {
      builder.newLine()
      builder.addText('📉 BIGGEST LOSERS')
      builder.newLine()
      for (const trader of losers) {
        const emoji = rankEmojis[trader.rank - 1] || `${trader.rank}.`
        builder.addText(`${emoji} `)
        builder.addLink(trader.name, `https://polymarket.com/profile/${trader.wallet}`)
        if (trader.xUsername) {
          builder.addText(' · ')
          builder.addLink('𝕏', `https://x.com/${trader.xUsername}`)
        }
        builder.addText(
          ` ${formatSignedCompactUsd(trader.pnl)} | Wins: ${trader.wins}/${trader.totalBets} | ${trader.livePositions} live`
        )
        builder.newLine()
      }
    }

    builder.newLine()
    const now = new Date()
    const timeStr = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')} UTC`
    builder.addText(`🕘 Last Updated: ${timeStr}`)

    return builder.build()
  }
}
