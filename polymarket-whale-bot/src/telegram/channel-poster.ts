import fs from 'node:fs';
import { Markup, Telegraf } from 'telegraf';
import { CardGenerator } from '../image/card-generator';
import { EnrichedTrade, TelegramConfig } from '../types';
import { formatMultiplier, formatPriceCents, formatResolveDate, formatUsd } from '../utils/formatter';
import { logger } from '../utils/logger';
import { TRADER_TYPE_META } from '../classifier/trader-classifier';
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
  EMOJI_PORTFOLIO,
  PremiumEmoji,
} from './premium-emojis';

interface CaptionResult {
  text: string;
  entities: Array<
    | {
        type: 'custom_emoji';
        offset: number;
        length: number;
        custom_emoji_id: string;
      }
    | {
        type: 'text_link';
        offset: number;
        length: number;
        url: string;
      }
  >;
}

class CaptionBuilder {
  private text = '';
  private entities: CaptionResult['entities'] = [];

  addPremiumEmoji(emoji: PremiumEmoji, textAfter = ''): this {
    const offset = this.text.length;
    const emojiLength = emoji.char.length;
    this.text += emoji.char;
    this.entities.push({
      type: 'custom_emoji',
      offset,
      length: emojiLength,
      custom_emoji_id: emoji.id,
    });
    if (textAfter) {
      this.text += textAfter;
    }
    return this;
  }

  addText(text: string): this {
    this.text += text;
    return this;
  }

  addLink(text: string, url: string): this {
    const offset = this.text.length;
    this.text += text;
    this.entities.push({
      type: 'text_link',
      offset,
      length: text.length,
      url,
    });
    return this;
  }

  newLine(): this {
    this.text += '\n';
    return this;
  }

  build(): CaptionResult {
    const trimmed = this.text.slice(0, 1024);
    const entities = this.entities.filter((entity) => entity.offset + entity.length <= trimmed.length);
    return { text: trimmed, entities };
  }
}

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
    const { text, entities } = this.buildCaption(trade);
    const output = `${text}\n\n--- ENTITIES ---\n${JSON.stringify(entities, null, 2)}`;
    await fs.promises.writeFile(outputPath, output);
  }

  async postAlert(trade: EnrichedTrade): Promise<void> {
    const { text, entities } = this.buildCaption(trade);
    const keyboard = this.buildKeyboard(trade);
    const image = await this.cardGenerator.generateCard(trade);

    try {
      if (image) {
        await this.bot.telegram.sendPhoto(
          this.config.channelId,
          { source: image },
          {
            caption: text,
            caption_entities: entities,
            reply_markup: keyboard.reply_markup,
          } as any,
        );
        return;
      }

      await this.bot.telegram.sendMessage(
        this.config.channelId,
        text,
        {
          entities,
          reply_markup: keyboard.reply_markup,
          link_preview_options: { is_disabled: true },
        } as any,
      );
    } catch (error: any) {
      const errorMsg = String(error?.message || error);
      if (errorMsg.includes('CUSTOM_EMOJI') || errorMsg.includes('custom emoji') || errorMsg.includes('premium')) {
        logger.warn('Premium custom emoji not supported, falling back to standard emoji');
        if (image) {
          await this.bot.telegram.sendPhoto(
            this.config.channelId,
            { source: image },
            { caption: text, reply_markup: keyboard.reply_markup },
          );
        } else {
          await this.bot.telegram.sendMessage(this.config.channelId, text, {
            reply_markup: keyboard.reply_markup,
            link_preview_options: { is_disabled: true },
          });
        }
        return;
      }
      throw error;
    }
  }

  private buildKeyboard(trade: EnrichedTrade) {
    const eventSlug = trade.marketInfo.eventSlug || trade.trade.eventSlug || trade.marketInfo.slug || trade.trade.slug;
    return Markup.inlineKeyboard([
      [Markup.button.url(this.config.referralButtonText, this.config.referralUrl)],
      [Markup.button.url('📊 View Polymarket', `https://polymarket.com/event/${eventSlug}`)],
    ]);
  }

  private buildCaption(trade: EnrichedTrade): CaptionResult {
    const typeEmoji = TRADER_TYPE_PREMIUM[trade.primaryType];
    const typeMeta = TRADER_TYPE_META[trade.primaryType];
    const displayName = trade.trade.name || trade.trade.pseudonym || trade.trade.proxyWallet.slice(0, 10);
    const side = trade.trade.side === 'BUY' ? 'Buy' : 'Sell';
    const question = trade.marketInfo.question || trade.trade.title;
    const outcome = trade.trade.outcome || String(trade.trade.outcomeIndex);
    const eventSlug = trade.marketInfo.eventSlug || trade.trade.eventSlug || trade.marketInfo.slug || trade.trade.slug;
    const marketUrl = `https://polymarket.com/event/${eventSlug}`;

    const builder = new CaptionBuilder();

    builder.addPremiumEmoji(typeEmoji, ` ${typeMeta.label}`);
    builder.newLine().newLine();
    builder.addLink(question, marketUrl);
    builder.newLine();
    builder.addPremiumEmoji(EMOJI_CALENDAR, ` Resolves: ${formatResolveDate(trade.marketInfo.endDate)}`);
    builder.newLine().newLine();
    builder.addPremiumEmoji(EMOJI_TARGET, ` ${side} ${outcome}`);
    builder.newLine();
    builder.addText('├ ');
    builder.addPremiumEmoji(EMOJI_MONEYBAG, ` Amount: ${formatUsd(trade.trade.usdcSize)}`);
    builder.newLine();
    builder.addText('├ ');
    builder.addPremiumEmoji(EMOJI_COIN, ` Price: ${formatPriceCents(trade.trade.price)}`);
    builder.newLine();
    builder.addText('└ ');
    builder.addPremiumEmoji(EMOJI_MONEY, ` To win: ${formatUsd(trade.potentialWin)} (${formatMultiplier(trade.multiplier)})`);
    builder.newLine().newLine();
    builder.addPremiumEmoji(EMOJI_TRADER, ` Trader: ${displayName}`);
    builder.newLine();

    if (trade.isFreshWallet) {
      builder.addText('├ 🆕 Fresh Wallet');
      builder.newLine();
    }

    builder.addText('├ ');
    builder.addPremiumEmoji(EMOJI_CHART_UP, ` Positions: ${formatUsd(trade.traderStats.totalPositionsValue)}`);
    builder.newLine();

    if (trade.traderStats.closedPositions >= 3) {
      builder.addText('├ ');
      builder.addPremiumEmoji(EMOJI_CHECK, ` Win Rate: ${trade.traderStats.winRateLabel}`);
      builder.newLine();
    }

    builder.addText('└ ');
    builder.addPremiumEmoji(EMOJI_PORTFOLIO, ` Portfolio: ${formatUsd(trade.traderStats.portfolioValue)}`);

    return builder.build();
  }
}
