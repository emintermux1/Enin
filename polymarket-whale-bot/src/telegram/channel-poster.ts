import fs from 'node:fs';
import { Markup, Telegraf } from 'telegraf';
import { CardGenerator } from '../image/card-generator';
import { EnrichedTrade, TelegramConfig } from '../types';
import { formatMultiplier, formatPriceCents, formatResolveDate, formatUsd } from '../utils/formatter';
import { logger } from '../utils/logger';
import { TRADER_TYPE_META } from '../classifier/trader-classifier';

export class ChannelPoster {
  private readonly bot: Telegraf;
  private readonly cardGenerator = new CardGenerator();
  private launched = false;

  constructor(private readonly config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken);
    this.bot.start(async (ctx) => {
      await ctx.reply(`Polymarket Whale Bot is online. Channel default: ${this.config.channelId}.`);
    });
  }

  async launch(): Promise<void> {
    if (this.launched) {
      return;
    }
    await this.bot.launch();
    this.launched = true;
    logger.info(`Telegram posting target: ${this.config.channelId}`);
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
    await fs.promises.writeFile(outputPath, this.buildCaption(trade));
  }

  async postAlert(trade: EnrichedTrade): Promise<void> {
    const caption = this.buildCaption(trade);
    const keyboard = this.buildKeyboard(trade);
    const image = await this.cardGenerator.generateCard(trade);

    if (image) {
      await this.bot.telegram.sendPhoto(this.config.channelId, { source: image }, { caption, reply_markup: keyboard.reply_markup });
      return;
    }

    await this.bot.telegram.sendMessage(this.config.channelId, caption, {
      reply_markup: keyboard.reply_markup,
      link_preview_options: { is_disabled: true },
    });
  }

  private buildKeyboard(trade: EnrichedTrade) {
    const eventSlug = trade.marketInfo.eventSlug || trade.trade.eventSlug || trade.marketInfo.slug || trade.trade.slug;
    return Markup.inlineKeyboard([
      [Markup.button.url(this.config.referralButtonText, this.config.referralUrl)],
      [Markup.button.url('📊 View Market', `https://polymarket.com/event/${eventSlug}`)],
      [Markup.button.url('👤 View Trader', `https://polymarket.com/profile/${trade.trade.proxyWallet}`)],
    ]);
  }

  private buildCaption(trade: EnrichedTrade): string {
    const typeMeta = TRADER_TYPE_META[trade.primaryType];
    const displayName = trade.trade.name || trade.trade.pseudonym || trade.trade.proxyWallet.slice(0, 10);
    const side = trade.trade.side === 'BUY' ? 'Buy' : 'Sell';
    const question = trade.marketInfo.question || trade.trade.title;
    const outcome = trade.trade.outcome || String(trade.trade.outcomeIndex);
    const lines = [
      `${typeMeta.emoji} ${typeMeta.label}`,
      '',
      question,
      `📅 Resolves: ${formatResolveDate(trade.marketInfo.endDate)}`,
      '',
      `🎯 ${side} ${outcome}`,
      `├ Amount: ${formatUsd(trade.trade.usdcSize)}`,
      `├ Price: ${formatPriceCents(trade.trade.price)}`,
      `└ To win: ${formatUsd(trade.potentialWin)} (${formatMultiplier(trade.multiplier)})`,
      '',
      `🥷 Trader: ${displayName}`,
      `├ Positions: ${formatUsd(trade.traderStats.totalPositionsValue)}`,
    ];

    if (trade.traderStats.closedPositions >= 3) {
      lines.push(`├ Win Rate: ${trade.traderStats.winRateLabel}`);
    }

    lines.push(`└ Portfolio: ${formatUsd(trade.traderStats.portfolioValue)}`);

    return lines.join('\n').slice(0, 1024);
  }
}
