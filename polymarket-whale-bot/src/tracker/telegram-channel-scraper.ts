import { HttpClient } from '../api/http-client';
import { ScrapedChannelSource, ScrapedChannelTrade } from '../types';
import { logger } from '../utils/logger';

const DEFAULT_CHANNELS: ScrapedChannelSource[] = ['polymarket_whale', 'polymarket_whales', 'polycop_signal'];
const POST_PATTERN = /data-post="([^"/]+)\/(\d+)"/g;
const MESSAGE_TEXT_PATTERN = /<div class="tgme_widget_message_text js-message_text" dir="auto">([\s\S]*?)<\/div>/;
const TIMESTAMP_PATTERN = /<time datetime="([^"]+)"/;
const WALLET_PATTERN = /https:\/\/polymarket\.com\/profile\/(0x[a-fA-F0-9]{40})/;
const MARKET_URL_PATTERN = /https:\/\/polymarket\.com\/event\/([^"'?#/]+)\/([^"'?#/]+)/;
const SMART_SCORE_PATTERN = /Smart\s*Score[:\s]*(\d+)/i;
const POLYCOP_WIN_RATE_PATTERN = /Win\s*Rate[:\s]*([\d.]+%?)/i;
const POLYCOP_BACKTEST_PATTERN = /Backtest\s*PnL[:\s]*/i;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlToText(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|p)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseCurrency(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.replace(/[$,\s]/g, '');
  if (!normalized) {
    return undefined;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function parseSignedCurrency(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const sign = raw.includes('-') ? -1 : 1;
  const magnitude = parseCurrency(raw);
  return magnitude === undefined ? undefined : sign * magnitude;
}

function parseNumber(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.replace(/[,\s]/g, '');
  if (!normalized) {
    return undefined;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeOutcome(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'yes' || lower.endsWith(' yes')) {
    return 'Yes';
  }
  if (lower === 'no' || lower.endsWith(' no')) {
    return 'No';
  }
  return trimmed;
}

function resolveTradeType(header: string, channel: ScrapedChannelSource): string {
  const normalized = header.toLowerCase();
  if (header.startsWith('🐋') || normalized.includes('whale trade')) {
    return 'WHALE';
  }
  if (header.startsWith('🕵️') || normalized.includes('insider')) {
    return 'INSIDER';
  }
  if (header.startsWith('🔥') || normalized.includes('conviction') || normalized.includes('accumulation')) {
    return 'CONVICTION_BUILD';
  }
  if (header.startsWith('🎯') || normalized.includes('high risk')) {
    return normalized.includes('insider') ? 'INSIDER' : 'HIGH_RISK';
  }
  return channel === 'polymarket_whale' ? 'WHALE' : 'HIGH_RISK';
}

function parseSharedFields(
  text: string,
  source: ScrapedChannelSource,
  messageId: string,
  timestamp: number,
): ScrapedChannelTrade | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 4) {
    return null;
  }

  const header = lines[0] ?? '';
  const marketQuestion = lines.find((line, index) =>
    index > 0
    && !/^resolves:/i.test(line)
    && !/^(buy|sell)\b/i.test(line)
    && !/^amount:/i.test(line)
    && !/^price:/i.test(line)
    && !/^shares:/i.test(line)
    && !/^to win:/i.test(line)
    && !/^trader:/i.test(line),
  ) ?? '';
  const actionLine = lines.find((line) =>
    /(?:^| )(buy|sell)\b/i.test(line)
    && !/^top holders/i.test(line)
    && !/^trader:/i.test(line),
  );

  if (!header || !marketQuestion || !actionLine) {
    return null;
  }

  const actionMatch = actionLine.match(/(Buy|Sell)\s+(.+)$/i);
  if (!actionMatch) {
    return null;
  }

  const rawSide = actionMatch[1] ?? 'Buy';
  const rawOutcome = actionMatch[2] ?? '';
  const amount = parseCurrency(text.match(/Amount:\s*([+\-]?\$[\d,]+(?:\.\d+)?)/i)?.[1]);
  const priceCents = parseNumber(text.match(/Price:\s*([\d.]+)¢/i)?.[1]);
  const traderName = text.match(/Trader:\s*(.+)/i)?.[1]?.trim() ?? '';

  if (amount === undefined || priceCents === undefined || !traderName) {
    return null;
  }

  return {
    source,
    messageId,
    tradeType: resolveTradeType(header, source),
    marketQuestion,
    side: rawSide.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
    outcome: normalizeOutcome(rawOutcome),
    amount,
    price: priceCents / 100,
    toWin: parseCurrency(text.match(/To win:\s*([+\-]?\$[\d,]+(?:\.\d+)?)/i)?.[1]),
    shares: parseNumber(text.match(/Shares:\s*([\d,]+(?:\.\d+)?)/i)?.[1]),
    resolveDate: text.match(/Resolves:\s*(.+)/i)?.[1]?.trim(),
    traderName,
    walletAddress: text.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0],
    positions: parseCurrency(text.match(/Positions:\s*([+\-]?\$[\d,]+(?:\.\d+)?)/i)?.[1]),
    winRate: text.match(/Win Rate:\s*([^\n]+)/i)?.[1]?.trim(),
    pnl: parseSignedCurrency(text.match(/Realized P\/L:\s*([+\-]?\$[\d,]+(?:\.\d+)?)/i)?.[1]),
    topHolders: text.match(/(Top Holders:\s*\d+(?:\/\d+)?\s+[A-Za-z]+\s+[·•]\s+\d+(?:\/\d+)?\s+[A-Za-z]+|\d+\/\d+\s+Top Holders on\s+[A-Za-z]+\s+side)/i)?.[1],
    timestamp,
  };
}

function parsePolycopFields(
  text: string,
  source: ScrapedChannelSource,
  messageId: string,
  timestamp: number,
): ScrapedChannelTrade | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 4) {
    return null;
  }

  const marketQuestion = lines[0] ?? '';
  const actionLine = lines.find((line) => /(?:^| )(buy|sell)\b/i.test(line));
  const amount = parseCurrency(text.match(/Amount:\s*([+\-]?\$[\d,]+(?:\.\d+)?)/i)?.[1]);
  const smartScore = parseNumber(text.match(SMART_SCORE_PATTERN)?.[1]);
  const polycopWinRate = text.match(POLYCOP_WIN_RATE_PATTERN)?.[1]?.trim();
  const traderName = text.match(/Whale\s*Profile:\s*(.+)/i)?.[1]?.trim() ?? '';

  if (!marketQuestion || !actionLine || amount === undefined || !traderName) {
    return null;
  }

  const actionMatch = actionLine.match(/(Buy|Sell)\s+(.+?)\s*\|\s*\$?([\d.]+)/i);
  if (!actionMatch) {
    return null;
  }

  const rawSide = actionMatch[1] ?? 'Buy';
  const rawOutcome = actionMatch[2] ?? '';
  const price = parseNumber(actionMatch[3]);
  if (price === undefined) {
    return null;
  }

  if (POLYCOP_BACKTEST_PATTERN.test(text)) {
    POLYCOP_BACKTEST_PATTERN.lastIndex = 0;
  }

  return {
    source,
    messageId,
    tradeType: 'SMART_MONEY',
    marketQuestion,
    side: rawSide.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
    outcome: normalizeOutcome(rawOutcome),
    amount,
    price,
    traderName,
    walletAddress: text.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0],
    smartScore: smartScore !== undefined ? Math.max(0, Math.min(100, smartScore)) : undefined,
    polycopWinRate,
    timestamp,
  };
}

export class TelegramChannelScraper {
  private readonly client: HttpClient;
  private readonly lastMessageIds = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;

  constructor(
    private readonly onTrade: (trade: ScrapedChannelTrade) => Promise<void>,
    private readonly pollIntervalMs = 60_000,
    private readonly channels: ScrapedChannelSource[] = DEFAULT_CHANNELS,
  ) {
    this.client = new HttpClient('https://t.me', {
      timeoutMs: 15_000,
      retries: 2,
      minSpacingMs: 100,
    });
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    logger.info(`Starting Telegram channel scraping every ${this.pollIntervalMs}ms`);
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running || this.processing) {
      return;
    }
    this.processing = true;
    try {
      const results = await Promise.allSettled(this.channels.map((channel) => this.scrapeChannel(channel)));
      for (const result of results) {
        if (result.status !== 'fulfilled') {
          logger.warn('Telegram channel scrape failed', result.reason);
          continue;
        }
        const { channel, trades, latestMessageId } = result.value;
        let lastProcessedMessageId = this.lastMessageIds.get(channel) ?? 0;
        try {
          for (const trade of trades) {
            await this.onTrade(trade);
            lastProcessedMessageId = Number(trade.messageId);
          }
          if (trades.length > 0 && latestMessageId > lastProcessedMessageId) {
            lastProcessedMessageId = latestMessageId;
          }
        } catch (error) {
          if (lastProcessedMessageId > 0) {
            this.lastMessageIds.set(channel, lastProcessedMessageId);
          }
          logger.warn(`Telegram channel trade processing failed for ${channel}`, error);
          continue;
        }

        if (trades.length > 0 && lastProcessedMessageId > 0) {
          this.lastMessageIds.set(channel, lastProcessedMessageId);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async scrapeChannel(channel: ScrapedChannelSource): Promise<{
    channel: ScrapedChannelSource;
    trades: ScrapedChannelTrade[];
    latestMessageId: number;
  }> {
    const html = await this.client.get<string>(`/s/${channel}`, {
      responseType: 'text',
    });
    const parsed = this.parseMessages(html, channel)
      .sort((left, right) => Number(left.messageId) - Number(right.messageId));
    const latestMessageId = parsed.length > 0 ? Number(parsed[parsed.length - 1]?.messageId ?? 0) : 0;
    const lastSeenMessageId = this.lastMessageIds.get(channel);

    if (lastSeenMessageId === undefined) {
      this.lastMessageIds.set(channel, latestMessageId);
      logger.info(`Initialized Telegram scraper baseline for ${channel} at message ${latestMessageId}`);
      return {
        channel,
        trades: [],
        latestMessageId,
      };
    }

    return {
      channel,
      trades: parsed.filter((trade) => Number(trade.messageId) > lastSeenMessageId),
      latestMessageId,
    };
  }

  private parseMessages(html: string, channel: ScrapedChannelSource): ScrapedChannelTrade[] {
    const trades: ScrapedChannelTrade[] = [];
    const matches = [...html.matchAll(POST_PATTERN)];
    for (const [index, match] of matches.entries()) {
      const matchChannel = match[1];
      const messageId = match[2];
      const start = match.index;
      const end = matches[index + 1]?.index ?? html.length;
      const block = start !== undefined ? html.slice(start, end) : '';
      const rawMessageHtml = block.match(MESSAGE_TEXT_PATTERN)?.[1];
      const isoTimestamp = block.match(TIMESTAMP_PATTERN)?.[1];
      if (!matchChannel || matchChannel.toLowerCase() !== channel.toLowerCase() || !rawMessageHtml || !messageId || !isoTimestamp) {
        continue;
      }
      const text = htmlToText(rawMessageHtml);
      const timestamp = Math.floor(new Date(isoTimestamp).getTime() / 1000);
      if (!text || !Number.isFinite(timestamp)) {
        continue;
      }
      if (channel === 'polycop_signal') {
        const polycopTrade = parsePolycopFields(text, channel, messageId, timestamp);
        if (!polycopTrade) {
          logger.debug(`Skipping unparseable PolyCop message ${messageId}`);
          continue;
        }
        const walletFromHtml = rawMessageHtml.match(WALLET_PATTERN)?.[1];
        if (walletFromHtml) {
          polycopTrade.walletAddress = walletFromHtml;
        }
        const marketMatch = rawMessageHtml.match(MARKET_URL_PATTERN);
        if (marketMatch) {
          polycopTrade.eventSlug = marketMatch[1];
          polycopTrade.marketSlug = marketMatch[2];
          polycopTrade.marketUrl = marketMatch[0];
        }
        trades.push(polycopTrade);
        continue;
      }
      const parser = channel === 'polymarket_whale'
        ? this.parseWhaleAlertMessage.bind(this)
        : this.parseWhalesAlertMessage.bind(this);
      const trade = parser(text, messageId, timestamp);
      if (!trade) {
        continue;
      }
      if (!trade.walletAddress) {
        const walletFromHtml = rawMessageHtml.match(WALLET_PATTERN)?.[1];
        if (walletFromHtml) {
          trade.walletAddress = walletFromHtml;
        }
      }
      const marketMatch = rawMessageHtml.match(MARKET_URL_PATTERN);
      if (marketMatch) {
        trade.eventSlug = marketMatch[1];
        trade.marketSlug = marketMatch[2];
        trade.marketUrl = marketMatch[0];
      }
      trades.push(trade);
    }
    return trades;
  }

  private parseWhaleAlertMessage(text: string, messageId: string, timestamp: number): ScrapedChannelTrade | null {
    return parseSharedFields(text, 'polymarket_whale', messageId, timestamp);
  }

  private parseWhalesAlertMessage(text: string, messageId: string, timestamp: number): ScrapedChannelTrade | null {
    return parseSharedFields(text, 'polymarket_whales', messageId, timestamp);
  }
}
