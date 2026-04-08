import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { LRUCache } from 'lru-cache';
import { EnrichedTrade, TraderType } from '../types';
import { formatMultiplier, formatPriceCents, formatResolveDate, formatUsd, truncateText } from '../utils/formatter';
import { logger } from '../utils/logger';

type CanvasModule = {
  createCanvas: (width: number, height: number) => any;
  loadImage: (source: Buffer | string) => Promise<any>;
  registerFont?: (path: string, options: { family: string; weight?: string }) => void;
  GlobalFonts?: { registerFromPath: (path: string, family: string) => boolean };
};

const CARD_LABELS: Record<TraderType, string> = {
  WHALE: 'WHALE ALERT',
  INSIDER: 'INSIDER SPOTTED',
  TOP_HOLDER: 'TOP HOLDER',
  CONVICTION_BUILD: 'CONVICTION BUILD',
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

function wrapText(ctx: any, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
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
    }
    current = word;
    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === maxLines) {
    let lastLine = lines[maxLines - 1] ?? '';
    while (ctx.measureText(`${lastLine}…`).width > maxWidth && lastLine.length > 0) {
      lastLine = lastLine.slice(0, -1).trimEnd();
    }
    if (lastLine !== lines[maxLines - 1]) {
      lines[maxLines - 1] = `${lastLine}…`;
    }
  }

  return lines;
}

function fitFontSize(ctx: any, text: string, maxWidth: number, startingSize: number, minSize: number, fontWeight = 600): number {
  for (let size = startingSize; size >= minSize; size -= 1) {
    ctx.font = `${fontWeight} ${size}px Inter, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) {
      return size;
    }
  }
  return minSize;
}

function drawBadge(ctx: any, x: number, y: number, text: string, bg: string, color: string) {
  ctx.font = '800 24px Inter, Arial, sans-serif';
  const width = ctx.measureText(text).width + 34;
  fillRoundedRect(ctx, x, y, width, 42, 21, bg);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 17, y + 21);
  ctx.textBaseline = 'alphabetic';
  return width;
}

export class CardGenerator {
  private modulePromise: Promise<CanvasModule | null> | null = null;
  private readonly imageCache = new LRUCache<string, Buffer>({ max: 100, ttl: 1000 * 60 * 60 * 6 });
  private fontsReady = false;
  private readonly dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

  async generateCard(trade: EnrichedTrade): Promise<Buffer | null> {
    const canvasModule = await this.getCanvasModule();
    if (!canvasModule) {
      return null;
    }

    this.ensureFonts(canvasModule);

    const canvas = canvasModule.createCanvas(1280, 720);
    const ctx = canvas.getContext('2d');
    const cardX = 24;
    const cardY = 24;
    const cardWidth = 1232;
    const cardHeight = 672;
    const question = trade.marketInfo.question || trade.trade.title;
    const displayName = trade.trade.name || trade.trade.pseudonym || trade.trade.proxyWallet.slice(0, 10);
    const side = trade.trade.side === 'BUY' ? 'Buy' : 'Sell';
    const action = trade.trade.side === 'BUY' ? 'BUY' : 'SELL';
    const outcome = trade.trade.outcome || String(trade.trade.outcomeIndex);
    const badgeColor = trade.trade.side === 'BUY' ? '#22c55e' : '#ef4444';
    const label = CARD_LABELS[trade.primaryType];

    ctx.fillStyle = '#060913';
    ctx.fillRect(0, 0, 1280, 720);

    fillRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 34, '#0b1220');

    const heroImage = await this.loadMarketImage(canvasModule, trade.marketInfo.image || trade.trade.icon);
    ctx.save();
    roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 34);
    ctx.clip();

    if (heroImage) {
      ctx.drawImage(heroImage, cardX, cardY, cardWidth, cardHeight);
    } else {
      const fallback = ctx.createLinearGradient(cardX, cardY, cardX + cardWidth, cardY + cardHeight);
      fallback.addColorStop(0, '#152235');
      fallback.addColorStop(0.5, '#0f1728');
      fallback.addColorStop(1, '#1f2937');
      ctx.fillStyle = fallback;
      ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
    }

    const overlay = ctx.createLinearGradient(0, cardY, 0, cardY + cardHeight);
    overlay.addColorStop(0, 'rgba(4,7,13,0.42)');
    overlay.addColorStop(0.33, 'rgba(4,7,13,0.62)');
    overlay.addColorStop(0.72, 'rgba(4,7,13,0.2)');
    overlay.addColorStop(1, 'rgba(4,7,13,0.88)');
    ctx.fillStyle = overlay;
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight);

    const vignette = ctx.createRadialGradient(860, 210, 40, 860, 210, 660);
    vignette.addColorStop(0, 'rgba(255,255,255,0)');
    vignette.addColorStop(1, 'rgba(4,7,13,0.4)');
    ctx.fillStyle = vignette;
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
    ctx.restore();

    ctx.font = '700 20px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(233,240,255,0.82)';
    ctx.fillText(label, 76, 84);

    ctx.font = '800 58px Inter, Arial, sans-serif';
    ctx.fillStyle = '#f8fafc';
    const titleLines = wrapText(ctx, question, 980, 2);
    titleLines.forEach((line, index) => {
      ctx.fillText(line, 76, 224 + index * 66);
    });

    ctx.font = '600 28px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(226,232,240,0.92)';
    ctx.fillText(`${side} ${outcome} · Resolves ${formatResolveDate(trade.marketInfo.endDate)}`, 76, 366);

    const barX = 56;
    const barY = 562;
    const barWidth = 1168;
    const barHeight = 112;
    fillRoundedRect(ctx, barX, barY, barWidth, barHeight, 28, 'rgba(6,12,21,0.82)');
    fillRoundedRect(ctx, barX, barY, barWidth, 2, 1, 'rgba(255,255,255,0.18)');

    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 42px Inter, Arial, sans-serif';
    const amountText = formatUsd(trade.trade.usdcSize);
    ctx.fillText(amountText, 84, 630);
    const amountWidth = ctx.measureText(amountText).width;

    const badgeX = 104 + amountWidth;
    const badgeWidth = drawBadge(ctx, badgeX, 596, action, badgeColor, '#071014');

    const infoText = `at ${formatPriceCents(trade.trade.price)}   Win ${formatUsd(trade.potentialWin)}   ${formatMultiplier(trade.multiplier)}   Trader ${truncateText(displayName, 18)}   Portfolio ${formatUsd(trade.traderStats.portfolioValue)}`;
    const infoX = badgeX + badgeWidth + 24;
    const infoMaxWidth = barX + barWidth - infoX - 28;
    const infoFontSize = fitFontSize(ctx, infoText, infoMaxWidth, 28, 18, 600);
    ctx.font = `600 ${infoFontSize}px Inter, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(241,245,249,0.94)';
    ctx.fillText(infoText, infoX, 629);

    return this.canvasToBuffer(canvas);
  }

  async generateCompactCard(trade: EnrichedTrade): Promise<Buffer | null> {
    return this.generateCard(trade);
  }

  async saveSampleCard(trade: EnrichedTrade, outputPath: string): Promise<boolean> {
    const card = await this.generateCard(trade);
    if (!card) {
      return false;
    }
    await fs.promises.writeFile(outputPath, card);
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
