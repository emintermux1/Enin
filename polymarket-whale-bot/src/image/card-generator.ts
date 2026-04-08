import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { LRUCache } from 'lru-cache';
import { EnrichedTrade } from '../types';
import {
  formatCompactUsd,
  formatMonthYear,
  formatMultiplier,
  formatPriceCents,
  formatResolveDate,
  formatResolveDay,
  formatSignedUsd,
  formatTimestamp,
  formatUsd,
  truncateText,
} from '../utils/formatter';
import { TRADER_TYPE_META } from '../classifier/trader-classifier';
import { logger } from '../utils/logger';

type CanvasModule = {
  createCanvas: (width: number, height: number) => any;
  loadImage: (source: Buffer | string) => Promise<any>;
  registerFont?: (path: string, options: { family: string; weight?: string }) => void;
  GlobalFonts?: { registerFromPath: (path: string, family: string) => boolean };
};

function roundedRect(ctx: any, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function fillRoundedRect(ctx: any, x: number, y: number, width: number, height: number, radius: number, fillStyle: string) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function strokeRoundedRect(ctx: any, x: number, y: number, width: number, height: number, radius: number, strokeStyle: string, lineWidth = 1) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function wrapText(ctx: any, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
    }
    if (lines.length === maxLines - 1) {
      break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines) {
    const lastLine = lines[maxLines - 1];
    if (lastLine) {
      lines[maxLines - 1] = truncateText(lastLine, 72);
    }
  }
  return lines;
}

function drawPill(ctx: any, text: string, x: number, y: number, options?: { bg?: string; color?: string; font?: string; paddingX?: number }) {
  const bg = options?.bg ?? '#171F2C';
  const color = options?.color ?? '#E5EEF9';
  const font = options?.font ?? '700 20px Inter, Arial, sans-serif';
  const paddingX = options?.paddingX ?? 16;
  ctx.font = font;
  const width = ctx.measureText(text).width + paddingX * 2;
  fillRoundedRect(ctx, x, y, width, 34, 17, bg);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + paddingX, y + 17);
  ctx.textBaseline = 'alphabetic';
  return width;
}

export class CardGenerator {
  private modulePromise: Promise<CanvasModule | null> | null = null;
  private readonly imageCache = new LRUCache<string, Buffer>({ max: 100, ttl: 1000 * 60 * 60 * 6 });
  private fontsReady = false;
  private readonly dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

  async generateCard(trade: EnrichedTrade): Promise<Buffer | null> {
    return this.generateCompactCard(trade);
  }

  async generateCompactCard(trade: EnrichedTrade): Promise<Buffer | null> {
    const canvasModule = await this.getCanvasModule();
    if (!canvasModule) {
      return null;
    }

    this.ensureFonts(canvasModule);

    const canvas = canvasModule.createCanvas(800, 860);
    const ctx = canvas.getContext('2d');
    const typeMeta = TRADER_TYPE_META[trade.primaryType];
    const riskTone = trade.risk.color;
    const accent = trade.trade.outcomeIndex === 0 ? '#22C55E' : '#EF4444';
    const surface = '#111722';
    const border = 'rgba(255,255,255,0.08)';

    const bg = ctx.createLinearGradient(0, 0, 800, 860);
    bg.addColorStop(0, '#0A0E15');
    bg.addColorStop(1, '#111826');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 800, 860);

    fillRoundedRect(ctx, 24, 24, 752, 812, 28, '#0E1420');
    strokeRoundedRect(ctx, 24, 24, 752, 812, 28, border);

    const heroImage = await this.loadMarketImage(canvasModule, trade.marketInfo.image || trade.trade.icon);
    ctx.save();
    roundedRect(ctx, 24, 24, 752, 212, 28);
    ctx.clip();
    if (heroImage) {
      ctx.drawImage(heroImage, 24, 24, 752, 212);
    } else {
      const fallback = ctx.createLinearGradient(24, 24, 776, 236);
      fallback.addColorStop(0, '#18253B');
      fallback.addColorStop(1, '#281847');
      ctx.fillStyle = fallback;
      ctx.fillRect(24, 24, 752, 212);
    }
    const overlay = ctx.createLinearGradient(0, 24, 0, 236);
    overlay.addColorStop(0, 'rgba(7,10,16,0.18)');
    overlay.addColorStop(1, 'rgba(7,10,16,0.92)');
    ctx.fillStyle = overlay;
    ctx.fillRect(24, 24, 752, 212);
    ctx.restore();

    let pillX = 42;
    pillX += drawPill(ctx, `${typeMeta.emoji} ${typeMeta.label}`, pillX, 42, { bg: 'rgba(6,12,21,0.8)', color: '#F8FAFC' }) + 10;
    pillX += drawPill(ctx, `${trade.signal.emoji} ${trade.signal.label}`, pillX, 42, { bg: 'rgba(6,12,21,0.8)', color: '#D8E9FF' }) + 10;
    drawPill(ctx, `${trade.risk.emoji} ${trade.risk.level}`, 776 - 42 - 180, 42, { bg: riskTone, color: '#FFFFFF', paddingX: 18 });

    ctx.font = '800 38px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    const titleLines = wrapText(ctx, trade.marketInfo.question || trade.trade.title, 680, 2);
    titleLines.forEach((line, index) => {
      ctx.fillText(line, 42, 136 + index * 42);
    });

    ctx.font = '600 20px Inter, Arial, sans-serif';
    ctx.fillStyle = '#C6D4E6';
    ctx.fillText(`Posted ${formatTimestamp(trade.trade.timestamp)} • Resolves ${formatResolveDay(trade.marketInfo.endDate)}`, 42, 206);

    fillRoundedRect(ctx, 42, 258, 716, 122, 22, surface);
    strokeRoundedRect(ctx, 42, 258, 716, 122, 22, border);

    let rowX = 62;
    rowX += drawPill(ctx, `${trade.trade.side === 'BUY' ? 'BUY' : 'SELL'} ${trade.trade.outcome.toUpperCase()}`, rowX, 278, { bg: accent, color: '#081018', paddingX: 18 }) + 12;
    rowX += drawPill(ctx, formatUsd(trade.trade.usdcSize), rowX, 278, { bg: '#18202D', color: '#F8FAFC' }) + 12;
    rowX += drawPill(ctx, formatPriceCents(trade.trade.price), rowX, 278, { bg: '#18202D', color: '#F8FAFC' }) + 12;
    drawPill(ctx, `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(trade.trade.size || trade.trade.usdcSize / Math.max(trade.trade.price, 0.01))} shares`, rowX, 278, { bg: '#18202D', color: '#F8FAFC' });

    ctx.font = '700 24px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(`To win ${formatUsd(trade.potentialWin)} (${formatMultiplier(trade.multiplier)})`, 62, 340);
    ctx.fillStyle = '#A6B5C8';
    ctx.font = '600 21px Inter, Arial, sans-serif';
    ctx.fillText(`Alpha ${trade.signal.confidence} • Strength ${trade.signal.score}/99 • ${trade.signal.summary}`, 62, 370);

    fillRoundedRect(ctx, 42, 402, 344, 190, 22, surface);
    fillRoundedRect(ctx, 414, 402, 344, 190, 22, surface);
    strokeRoundedRect(ctx, 42, 402, 344, 190, 22, border);
    strokeRoundedRect(ctx, 414, 402, 344, 190, 22, border);

    ctx.font = '800 24px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText('TRADER', 62, 438);
    ctx.fillText('MARKET FLOW', 434, 438);

    ctx.font = '800 28px Inter, Arial, sans-serif';
    ctx.fillText(truncateText(trade.traderLabel, 26), 62, 476);
    ctx.font = '600 20px Inter, Arial, sans-serif';
    ctx.fillStyle = '#B6C4D7';
    const rankLabel = trade.leaderboardSummary ? ` • ${trade.leaderboardSummary}` : '';
    ctx.fillText(`${formatCompactUsd(trade.trackedWallet?.vol ?? 0)} total volume${rankLabel}`.trim(), 62, 506);

    const traderRows = [
      ['Win rate', trade.traderStats.winRateLabel],
      ['Realized P/L', formatSignedUsd(trade.traderStats.totalRealizedPnl)],
      ['Portfolio', formatCompactUsd(trade.traderStats.portfolioValue)],
      ['Active since', formatMonthYear(trade.traderStats.activeSince) ?? '—'],
      ['Best streak', trade.traderStats.bestWinStreak ? `${trade.traderStats.bestWinStreak} wins` : '—'],
    ];
    traderRows.forEach(([label, value], index) => {
      const y = 540 + index * 24;
      ctx.fillStyle = '#8192A7';
      ctx.fillText(label, 62, y);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(value, 190, y);
    });

    const flowRows = [
      ['Top holders', `${trade.holderStats.topHoldersOnSide}/${trade.holderStats.totalTopHolders} on ${trade.holderStats.side}`],
      ['Whales', `${trade.holderStats.whalesInMarket}`],
      ['Insiders', `${trade.holderStats.insidersInMarket}`],
      ['Liquidity', formatCompactUsd(trade.marketInfo.liquidity)],
      ['Volume', formatCompactUsd(trade.marketInfo.volume)],
    ];
    flowRows.forEach(([label, value], index) => {
      const y = 476 + index * 28;
      ctx.fillStyle = '#8192A7';
      ctx.font = '600 20px Inter, Arial, sans-serif';
      ctx.fillText(label, 434, y);
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '800 22px Inter, Arial, sans-serif';
      ctx.fillText(value, 566, y);
    });

    fillRoundedRect(ctx, 42, 614, 716, 124, 22, surface);
    strokeRoundedRect(ctx, 42, 614, 716, 124, 22, border);
    ctx.font = '800 23px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText('SIGNAL STACK', 62, 650);
    const badgeText = trade.traderTypes.map((type) => `${TRADER_TYPE_META[type].emoji} ${TRADER_TYPE_META[type].label}`).join('   ');
    ctx.font = '700 22px Inter, Arial, sans-serif';
    ctx.fillStyle = '#D7E4F4';
    ctx.fillText(truncateText(badgeText, 56), 62, 688);
    ctx.font = '600 20px Inter, Arial, sans-serif';
    ctx.fillStyle = '#A6B5C8';
    ctx.fillText(`Tags: ${trade.marketInfo.tags.slice(0, 4).join(' • ') || 'Polymarket'}`, 62, 720);

    ctx.font = '600 18px Inter, Arial, sans-serif';
    ctx.fillStyle = '#617188';
    ctx.fillText('@polyalerttrackerbot', 42, 790);
    ctx.textAlign = 'right';
    ctx.fillText('Premium whale / insider flow', 758, 790);
    ctx.textAlign = 'left';

    return this.canvasToBuffer(canvas);
  }

  async generatePremiumCard(trade: EnrichedTrade): Promise<Buffer | null> {
    const canvasModule = await this.getCanvasModule();
    if (!canvasModule) {
      return null;
    }

    this.ensureFonts(canvasModule);

    const canvas = canvasModule.createCanvas(800, 1120);
    const ctx = canvas.getContext('2d');
    const typeMeta = TRADER_TYPE_META[trade.primaryType];
    const accent = trade.trade.outcomeIndex === 0 ? '#16C47F' : '#F45D5D';
    const surface = '#121A26';
    const border = 'rgba(255,255,255,0.08)';

    const bg = ctx.createLinearGradient(0, 0, 800, 1120);
    bg.addColorStop(0, '#090D14');
    bg.addColorStop(1, '#101827');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 800, 1120);

    fillRoundedRect(ctx, 24, 24, 752, 1072, 30, '#0D141F');
    strokeRoundedRect(ctx, 24, 24, 752, 1072, 30, border);

    const heroImage = await this.loadMarketImage(canvasModule, trade.marketInfo.image || trade.trade.icon);
    ctx.save();
    roundedRect(ctx, 42, 42, 716, 320, 24);
    ctx.clip();
    if (heroImage) {
      ctx.drawImage(heroImage, 42, 42, 716, 320);
    } else {
      const fallback = ctx.createLinearGradient(42, 42, 758, 362);
      fallback.addColorStop(0, '#1C2A43');
      fallback.addColorStop(1, '#2D1A49');
      ctx.fillStyle = fallback;
      ctx.fillRect(42, 42, 716, 320);
    }
    const overlay = ctx.createLinearGradient(0, 42, 0, 362);
    overlay.addColorStop(0, 'rgba(9,13,20,0.05)');
    overlay.addColorStop(1, 'rgba(9,13,20,0.96)');
    ctx.fillStyle = overlay;
    ctx.fillRect(42, 42, 716, 320);
    ctx.restore();

    drawPill(ctx, `${typeMeta.emoji} ${typeMeta.label}`, 60, 60, { bg: 'rgba(10,14,22,0.82)' });
    drawPill(ctx, `${trade.risk.emoji} ${trade.risk.level}`, 558, 60, { bg: trade.risk.color, color: '#FFFFFF', paddingX: 18 });

    ctx.font = '800 42px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    const titleLines = wrapText(ctx, trade.marketInfo.question || trade.trade.title, 660, 3);
    titleLines.forEach((line, index) => {
      ctx.fillText(line, 60, 248 + index * 42);
    });

    ctx.font = '600 21px Inter, Arial, sans-serif';
    ctx.fillStyle = '#CED9E8';
    ctx.fillText(`Signal ${trade.signal.confidence} • ${trade.signal.score}/99 strength • ${formatTimestamp(trade.trade.timestamp)}`, 60, 338);

    fillRoundedRect(ctx, 42, 392, 716, 154, 24, surface);
    strokeRoundedRect(ctx, 42, 392, 716, 154, 24, border);
    ctx.font = '800 26px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText('EXECUTION', 60, 432);
    let premiumPillX = 60;
    premiumPillX += drawPill(ctx, `${trade.trade.side === 'BUY' ? 'BUY' : 'SELL'} ${trade.trade.outcome.toUpperCase()}`, premiumPillX, 452, { bg: accent, color: '#081018', paddingX: 18 }) + 10;
    premiumPillX += drawPill(ctx, formatUsd(trade.trade.usdcSize), premiumPillX, 452, { bg: '#1B2432' }) + 10;
    premiumPillX += drawPill(ctx, formatPriceCents(trade.trade.price), premiumPillX, 452, { bg: '#1B2432' }) + 10;
    drawPill(ctx, `${formatMultiplier(trade.multiplier)} upside`, premiumPillX, 452, { bg: '#1B2432' });

    const executionRows = [
      ['Shares', new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(trade.trade.size || trade.trade.usdcSize / Math.max(trade.trade.price, 0.01))],
      ['Potential payout', formatUsd(trade.potentialWin)],
      ['Top holders on side', `${trade.holderStats.topHoldersOnSide}/${trade.holderStats.totalTopHolders}`],
      ['Whales / insiders', `${trade.holderStats.whalesInMarket} / ${trade.holderStats.insidersInMarket}`],
    ];
    executionRows.forEach(([label, value], index) => {
      const x = index % 2 === 0 ? 60 : 414;
      const y = index < 2 ? 516 : 548;
      ctx.font = '600 20px Inter, Arial, sans-serif';
      ctx.fillStyle = '#8192A7';
      ctx.fillText(label, x, y);
      ctx.font = '800 22px Inter, Arial, sans-serif';
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(value, x + 170, y);
    });

    fillRoundedRect(ctx, 42, 572, 344, 274, 24, surface);
    fillRoundedRect(ctx, 414, 572, 344, 274, 24, surface);
    strokeRoundedRect(ctx, 42, 572, 344, 274, 24, border);
    strokeRoundedRect(ctx, 414, 572, 344, 274, 24, border);

    ctx.font = '800 24px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText('TRADER PROFILE', 60, 612);
    ctx.fillText('MARKET READ', 432, 612);

    ctx.font = '800 30px Inter, Arial, sans-serif';
    ctx.fillText(truncateText(trade.traderLabel, 24), 60, 654);
    ctx.font = '600 20px Inter, Arial, sans-serif';
    ctx.fillStyle = '#B6C4D7';
    ctx.fillText(trade.leaderboardSummary ?? 'Tracked smart-money wallet', 60, 684);

    const traderRows = [
      ['Win rate', trade.traderStats.winRateLabel],
      ['Realized P/L', formatSignedUsd(trade.traderStats.totalRealizedPnl)],
      ['Portfolio', formatCompactUsd(trade.traderStats.portfolioValue)],
      ['Total volume', formatCompactUsd(trade.trackedWallet?.vol ?? 0)],
      ['Active since', formatMonthYear(trade.traderStats.activeSince) ?? '—'],
      ['Best streak', trade.traderStats.bestWinStreak ? `${trade.traderStats.bestWinStreak} wins` : '—'],
    ];
    traderRows.forEach(([label, value], index) => {
      const y = 726 + index * 28;
      ctx.fillStyle = '#8192A7';
      ctx.font = '600 20px Inter, Arial, sans-serif';
      ctx.fillText(label, 60, y);
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '800 22px Inter, Arial, sans-serif';
      ctx.fillText(value, 186, y);
    });

    const marketRows = [
      ['Signal', `${trade.signal.emoji} ${trade.signal.label}`],
      ['Confidence', `${trade.signal.confidence} • ${trade.signal.summary}`],
      ['Volume', formatCompactUsd(trade.marketInfo.volume)],
      ['Liquidity', formatCompactUsd(trade.marketInfo.liquidity)],
      ['Resolves', formatResolveDate(trade.marketInfo.endDate)],
      ['Tags', trade.marketInfo.tags.slice(0, 3).join(' • ') || 'Polymarket'],
    ];
    marketRows.forEach(([label, value], index) => {
      const y = 654 + index * 32;
      ctx.fillStyle = '#8192A7';
      ctx.font = '600 20px Inter, Arial, sans-serif';
      ctx.fillText(label, 432, y);
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '800 22px Inter, Arial, sans-serif';
      ctx.fillText(truncateText(String(value), 24), 552, y);
    });

    fillRoundedRect(ctx, 42, 872, 716, 158, 24, surface);
    strokeRoundedRect(ctx, 42, 872, 716, 158, 24, border);
    ctx.font = '800 24px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText('ALERT STACK', 60, 914);
    ctx.font = '700 24px Inter, Arial, sans-serif';
    ctx.fillStyle = '#DBE6F4';
    const stack = trade.traderTypes.map((type) => `${TRADER_TYPE_META[type].emoji} ${TRADER_TYPE_META[type].label}`).join('  •  ');
    ctx.fillText(truncateText(stack, 54), 60, 956);
    ctx.font = '600 20px Inter, Arial, sans-serif';
    ctx.fillStyle = '#97A8BD';
    ctx.fillText(`Posted ${formatTimestamp(trade.trade.timestamp)} • ${trade.trade.proxyWallet.slice(0, 10)}…`, 60, 996);

    ctx.font = '600 18px Inter, Arial, sans-serif';
    ctx.fillStyle = '#617188';
    ctx.fillText('@polyalerttrackerbot', 42, 1072);
    ctx.textAlign = 'right';
    ctx.fillText('Premium Polymarket signals', 758, 1072);
    ctx.textAlign = 'left';

    return this.canvasToBuffer(canvas);
  }

  async saveSampleCards(trade: EnrichedTrade, outputPaths: { compact: string; premium: string }): Promise<boolean> {
    const compact = await this.generateCompactCard(trade);
    const premium = await this.generatePremiumCard(trade);
    if (!compact || !premium) {
      return false;
    }
    await Promise.all([
      fs.promises.writeFile(outputPaths.compact, compact),
      fs.promises.writeFile(outputPaths.premium, premium),
    ]);
    return true;
  }

  private canvasToBuffer(canvas: any): Buffer | null {
    if (typeof canvas.encode === 'function') {
      return canvas.encode('png');
    }
    if (typeof canvas.toBuffer === 'function') {
      return canvas.toBuffer('image/png');
    }
    return null;
  }

  private async loadMarketImage(canvasModule: CanvasModule, imageUrl: string): Promise<any | null> {
    if (!imageUrl) {
      return null;
    }
    const cached = this.imageCache.get(imageUrl);
    const imageBuffer = cached
      ?? await axios
        .get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer', timeout: 15000 })
        .then((response) => Buffer.from(response.data))
        .catch((error) => {
          logger.warn(`Failed to download market image ${imageUrl}`, error);
          return null;
        });
    if (!imageBuffer) {
      return null;
    }
    if (!cached) {
      this.imageCache.set(imageUrl, imageBuffer);
    }
    return canvasModule.loadImage(imageBuffer).catch((error) => {
      logger.warn(`Failed to decode market image ${imageUrl}`, error);
      return null;
    });
  }

  private async getCanvasModule(): Promise<CanvasModule | null> {
    if (!this.modulePromise) {
      this.modulePromise = (async () => {
        try {
          return (await this.dynamicImport('@napi-rs/canvas')) as CanvasModule;
        } catch (napiError) {
          logger.warn('Falling back from @napi-rs/canvas', napiError);
          try {
            return (await this.dynamicImport('canvas')) as CanvasModule;
          } catch (canvasError) {
            logger.error('Canvas libraries unavailable; image posting disabled', canvasError);
            return null;
          }
        }
      })();
    }
    return this.modulePromise;
  }

  private ensureFonts(canvasModule: CanvasModule) {
    if (this.fontsReady) {
      return;
    }
    const fonts = [
      ['Inter-Regular.ttf', 'Inter'],
      ['Inter-SemiBold.ttf', 'Inter'],
      ['Inter-Bold.ttf', 'Inter'],
    ] as const;
    const fontDir = path.resolve(process.cwd(), 'assets/fonts');
    for (const [file, family] of fonts) {
      const fontPath = path.join(fontDir, file);
      if (!fs.existsSync(fontPath)) {
        continue;
      }
      try {
        if (canvasModule.GlobalFonts?.registerFromPath) {
          canvasModule.GlobalFonts.registerFromPath(fontPath, family);
        } else if (canvasModule.registerFont) {
          canvasModule.registerFont(fontPath, { family });
        }
      } catch (error) {
        logger.warn(`Failed to register font ${fontPath}`, error);
      }
    }
    this.fontsReady = true;
  }
}
