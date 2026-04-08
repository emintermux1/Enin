import { Markup, Telegraf } from 'telegraf';
import { CardGenerator } from '../image/card-generator';
import { EnrichedTrade, TelegramConfig } from '../types';
import { formatCompactUsd, formatPriceCents, formatResolveDay, formatSignedUsd, formatUsd, truncateText } from '../utils/formatter';
import { logger } from '../utils/logger';
import { TRADER_TYPE_META } from '../classifier/trader-classifier';

export class ChannelPoster {
  private readonly bot: Telegraf;
  private readonly cardGenerator = new CardGenerator();
  private launched = false;

  constructor(private readonly config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken);
    this.bot.start(async (ctx) => {
      const status = this.config.channelId
        ? `Alerts are configured for ${this.config.channelId}.`
        : 'Set TELEGRAM_CHANNEL_ID in .env and restart the bot before channel posting is enabled.';
      await ctx.reply(`Polymarket Whale Bot is online. ${status}`);
    });
  }

  async launch(): Promise<void> {
    if (this.launched) {
      return;
    }
    await this.bot.launch();
    this.launched = true;
    if (!this.config.channelId) {
      logger.error('TELEGRAM_CHANNEL_ID is not set. Bot will poll and enrich trades, but posting is disabled until configured.');
    }
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

  async postAlert(trade: EnrichedTrade): Promise<void> {
    if (!this.config.channelId) {
      throw new Error('Missing TELEGRAM_CHANNEL_ID. Configure a channel id or @username in .env to enable posting.');
    }

    const caption = this.buildCaption(trade);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url(this.config.referralButtonText, this.config.referralUrl)],
      [Markup.button.url('📊 View Market', `https://polymarket.com/event/${trade.trade.eventSlug}`)],
      [Markup.button.url('👤 View Trader', `https://polymarket.com/profile/${trade.trade.proxyWallet}`)],
    ]);

    const image = await this.cardGenerator.generateCard(trade);
    if (image) {
      await this.bot.telegram.sendPhoto(this.config.channelId, { source: image }, { caption, reply_markup: keyboard.reply_markup });
      return;
    }
    await this.bot.telegram.sendMessage(this.config.channelId, caption, { reply_markup: keyboard.reply_markup });
  }

  private buildCaption(trade: EnrichedTrade): string {
    const typeMeta = TRADER_TYPE_META[trade.primaryType];
    const displayName = trade.trade.pseudonym || trade.trade.name || trade.trade.proxyWallet.slice(0, 8);
    const tags = trade.marketInfo.tags.slice(0, 3).map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' ');
    const lines = [
      `${typeMeta.emoji} ${typeMeta.label} · ${trade.risk.emoji} ${trade.risk.level}`,
      '',
      `📌 ${truncateText(trade.marketInfo.question || trade.trade.title, 80)}`,
      `📅 Resolves: ${formatResolveDay(trade.marketInfo.endDate)}`,
      '',
      `◉ ${trade.trade.side === 'BUY' ? 'Buy' : 'Sell'} ${trade.trade.outcome} · ${formatUsd(trade.trade.usdcSize)} at ${formatPriceCents(trade.trade.price)}`,
      `💰 To win: ${formatUsd(trade.potentialWin)} (${trade.multiplier.toFixed(1)}x)`,
      '',
      `🐳 Trader: ${displayName}`,
      `├ Win Rate: ${trade.traderStats.winRateLabel}`,
      `├ P/L: ${formatSignedUsd(trade.traderStats.totalRealizedPnl)}`,
      `└ Portfolio: ${formatCompactUsd(trade.traderStats.portfolioValue)}`,
      '',
      `👥 ${trade.holderStats.topHoldersOnSide}/${trade.holderStats.totalTopHolders} Top Holders on ${trade.holderStats.side}`,
      `🐋 ${trade.holderStats.whalesInMarket} Whales · 🕵️ ${trade.holderStats.insidersInMarket} Insiders`,
      '',
      `🏷️ ${tags || '#Polymarket'}`,
    ];
    return lines.join('\n').slice(0, 1024);
  }
}
