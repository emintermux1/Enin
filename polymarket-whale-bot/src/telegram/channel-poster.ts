import fs from 'node:fs';
import { Markup, Telegraf } from 'telegraf';
import { CardGenerator } from '../image/card-generator';
import { EnrichedTrade, TelegramConfig } from '../types';
import {
  formatCompactUsd,
  formatMonthYear,
  formatPriceCents,
  formatResolveDay,
  formatSignedUsd,
  formatTimestamp,
  formatUsd,
  truncateText,
} from '../utils/formatter';
import { logger } from '../utils/logger';
import { TRADER_TYPE_META } from '../classifier/trader-classifier';

export class ChannelPoster {
  private readonly bot: Telegraf;
  private readonly cardGenerator = new CardGenerator();
  private launched = false;

  constructor(private readonly config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken);
    this.bot.start(async (ctx) => {
      await ctx.reply(`Polymarket Whale Bot is online. Channel default: ${this.config.channelId}. Mode: ${this.config.alertMode}.`);
    });
  }

  async launch(): Promise<void> {
    if (this.launched) {
      return;
    }
    await this.bot.launch();
    this.launched = true;
    logger.info(`Telegram posting target: ${this.config.channelId} (${this.config.alertMode} mode)`);
  }

  stop(reason = 'shutdown'): void {
    if (this.launched) {
      this.bot.stop(reason);
      this.launched = false;
    }
  }

  getCardGenerator(): CardGenerator {
    return this.cardGenerator;
  }

  async writeSampleOutput(trade: EnrichedTrade, outputPath: string): Promise<void> {
    const compactMessage = this.buildCompactMessage(trade);
    const mediaCaption = this.buildPhotoCaption(trade);
    const body = [
      'COMPACT ALERT',
      compactMessage,
      '',
      'PHOTO CAPTION',
      mediaCaption,
    ].join('\n');
    await fs.promises.writeFile(outputPath, body);
  }

  async postAlert(trade: EnrichedTrade): Promise<void> {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url(this.config.referralButtonText, this.config.referralUrl)],
      [Markup.button.url('📊 View Market', `https://polymarket.com/event/${trade.trade.eventSlug}`)],
      [Markup.button.url('👤 View Trader', `https://polymarket.com/profile/${trade.trade.proxyWallet}`)],
    ]);

    if (this.config.alertMode === 'compact') {
      await this.bot.telegram.sendMessage(this.config.channelId, this.buildCompactMessage(trade), {
        reply_markup: keyboard.reply_markup,
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    const image = await this.cardGenerator.generateCompactCard(trade);
    if (this.config.alertMode === 'image') {
      if (image) {
        await this.bot.telegram.sendPhoto(this.config.channelId, { source: image }, { caption: this.buildPhotoCaption(trade), reply_markup: keyboard.reply_markup });
        return;
      }
      await this.bot.telegram.sendMessage(this.config.channelId, this.buildCompactMessage(trade), {
        reply_markup: keyboard.reply_markup,
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    const sentMessage = await this.bot.telegram.sendMessage(this.config.channelId, this.buildCompactMessage(trade), {
      reply_markup: keyboard.reply_markup,
      link_preview_options: { is_disabled: true },
    });

    if (image) {
      await this.bot.telegram.sendPhoto(this.config.channelId, { source: image }, {
        caption: this.buildPhotoCaption(trade),
        disable_notification: true,
        reply_parameters: { message_id: sentMessage.message_id },
      });
    }
  }

  private buildCompactMessage(trade: EnrichedTrade): string {
    const typeMeta = TRADER_TYPE_META[trade.primaryType];
    const headline = `${typeMeta.emoji} ${typeMeta.label} • ${trade.risk.emoji} ${trade.risk.level}`;
    const traderMetrics = [
      `Win ${trade.traderStats.winRateLabel}`,
      `P/L ${formatSignedUsd(trade.traderStats.totalRealizedPnl)}`,
      `Port ${formatCompactUsd(trade.traderStats.portfolioValue)}`,
    ];
    if (trade.leaderboardSummary) {
      traderMetrics.push(trade.leaderboardSummary);
    }
    if (trade.trackedWallet?.vol) {
      traderMetrics.push(`Vol ${formatCompactUsd(trade.trackedWallet.vol)}`);
    }
    if (trade.traderStats.bestWinStreak) {
      traderMetrics.push(`Streak ${trade.traderStats.bestWinStreak}W`);
    }
    const activeSince = formatMonthYear(trade.traderStats.activeSince);

    const lines = [
      headline,
      truncateText(trade.marketInfo.question || trade.trade.title, 96),
      '',
      `◉ ${trade.trade.side === 'BUY' ? 'Buy' : 'Sell'} ${trade.trade.outcome} • ${formatUsd(trade.trade.usdcSize)} • ${formatPriceCents(trade.trade.price)} • ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(trade.trade.size || trade.trade.usdcSize / Math.max(trade.trade.price, 0.01))} shares`,
      `⚡ ${trade.signal.label} • ${trade.signal.confidence} confidence • ${trade.signal.score}/99 strength • To win ${formatUsd(trade.potentialWin)}`,
      '',
      `👤 ${trade.traderLabel}`,
      `   ${traderMetrics.join(' • ')}`,
      activeSince ? `   Active since ${activeSince}` : undefined,
      '',
      `🌊 ${trade.holderStats.topHoldersOnSide}/${trade.holderStats.totalTopHolders} top holders on ${trade.holderStats.side} • 🐋 ${trade.holderStats.whalesInMarket} whales • 🕵️ ${trade.holderStats.insidersInMarket} insiders`,
      `🕒 ${formatTimestamp(trade.trade.timestamp)} • Resolves ${formatResolveDay(trade.marketInfo.endDate)}`,
      trade.marketInfo.tags.length > 0 ? `🏷️ ${trade.marketInfo.tags.slice(0, 4).map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' ')}` : undefined,
    ];

    return lines.filter(Boolean).join('\n').slice(0, 4096);
  }

  private buildPhotoCaption(trade: EnrichedTrade): string {
    const typeMeta = TRADER_TYPE_META[trade.primaryType];
    const meta = [trade.signal.label, `${trade.signal.confidence} conf`, `${trade.signal.score}/99`].join(' • ');
    const traderSummary = [trade.traderStats.winRateLabel, formatSignedUsd(trade.traderStats.totalRealizedPnl)];
    if (trade.leaderboardSummary) {
      traderSummary.push(trade.leaderboardSummary);
    }

    const lines = [
      `${typeMeta.emoji} ${typeMeta.label} • ${trade.risk.emoji} ${trade.risk.level}`,
      `📌 ${truncateText(trade.marketInfo.question || trade.trade.title, 84)}`,
      '',
      `◉ ${trade.trade.side === 'BUY' ? 'Buy' : 'Sell'} ${trade.trade.outcome} • ${formatUsd(trade.trade.usdcSize)} @ ${formatPriceCents(trade.trade.price)}`,
      `⚡ ${meta}`,
      `👤 ${trade.traderLabel} • ${traderSummary.join(' • ')}`,
      `🌊 ${trade.holderStats.topHoldersOnSide}/${trade.holderStats.totalTopHolders} on ${trade.holderStats.side} • 🐋 ${trade.holderStats.whalesInMarket} • 🕵️ ${trade.holderStats.insidersInMarket}`,
      `🕒 ${formatTimestamp(trade.trade.timestamp)} • ⏳ ${formatResolveDay(trade.marketInfo.endDate)}`,
    ];

    return lines.join('\n').slice(0, 1024);
  }
}
