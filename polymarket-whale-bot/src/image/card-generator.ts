import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { LRUCache } from 'lru-cache';
import { EnrichedTrade } from '../types';
import { formatCompactUsd, formatMultiplier, formatPriceCents, formatResolveDate, formatSignedUsd, formatUsd, truncateText } from '../utils/formatter';
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

    const canvas = canvasModule.createCanvas(800, 1100);
    const ctx = canvas.getContext('2d');
    const typeMeta = TRADER_TYPE_META[trade.primaryType];

    const bg = ctx.createLinearGradient(0, 0, 800, 1100);
    bg.addColorStop(0, '#0D1117');
    bg.addColorStop(1, '#111827');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 800, 1100);

    const header = ctx.createLinearGradient(0, 0, 800, 0);
    header.addColorStop(0, '#0B2747');
    header.addColorStop(1, '#5B2E91');
    ctx.fillStyle = header;
    roundedRect(ctx, 20, 20, 760, 86, 18);
    ctx.fill();

    ctx.font = '700 36px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(`${typeMeta.emoji} ${typeMeta.label}`, 42, 72);

    roundedRect(ctx, 540, 36, 220, 42, 16);
    ctx.fillStyle = trade.risk.color;
    ctx.fill();
    ctx.font = '700 24px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${trade.risk.emoji} ${trade.risk.level}`, 650, 65);
    ctx.textAlign = 'left';

    const cardBg = '#161B22';
    await this.drawMarketHero(ctx, canvasModule, trade, cardBg);

    this.drawTradeSection(ctx, trade, cardBg);
    this.drawTopHolderSection(ctx, trade, cardBg);
    this.drawTraderSection(ctx, trade, cardBg);
    this.drawFooter(ctx, trade);

    if (typeof canvas.encode === 'function') {
      return canvas.encode('png');
    }
    if (typeof canvas.toBuffer === 'function') {
      return canvas.toBuffer('image/png');
    }
    return null;
  }

  async saveSampleCard(trade: EnrichedTrade, outputPath: string): Promise<boolean> {
    const buffer = await this.generateCard(trade);
    if (!buffer) {
      return false;
    }
    await fs.promises.writeFile(outputPath, buffer);
    return true;
  }

  private async drawMarketHero(ctx: any, canvasModule: CanvasModule, trade: EnrichedTrade, cardBg: string) {
    roundedRect(ctx, 20, 124, 760, 332, 20);
    ctx.fillStyle = cardBg;
    ctx.fill();

    roundedRect(ctx, 40, 144, 720, 292, 18);
    ctx.save();
    ctx.clip();
    const heroImage = await this.loadMarketImage(canvasModule, trade.marketInfo.image || trade.trade.icon);
    if (heroImage) {
      ctx.drawImage(heroImage, 40, 144, 720, 292);
    } else {
      const fallback = ctx.createLinearGradient(40, 144, 760, 436);
      fallback.addColorStop(0, '#1D4ED8');
      fallback.addColorStop(1, '#7C3AED');
      ctx.fillStyle = fallback;
      ctx.fillRect(40, 144, 720, 292);
    }
    const overlay = ctx.createLinearGradient(0, 240, 0, 436);
    overlay.addColorStop(0, 'rgba(13, 17, 23, 0)');
    overlay.addColorStop(1, 'rgba(13, 17, 23, 0.92)');
    ctx.fillStyle = overlay;
    ctx.fillRect(40, 144, 720, 292);
    ctx.restore();

    ctx.font = '700 34px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    const titleLines = wrapText(ctx, trade.marketInfo.question || trade.trade.title, 650, 2);
    titleLines.forEach((line, index) => {
      ctx.fillText(line, 64, 356 + index * 38);
    });

    ctx.font = '500 22px Inter, Arial, sans-serif';
    ctx.fillStyle = '#CBD5E1';
    ctx.fillText(`📅 Resolves: ${formatResolveDate(trade.marketInfo.endDate)}`, 64, 424);
  }

  private drawTradeSection(ctx: any, trade: EnrichedTrade, cardBg: string) {
    roundedRect(ctx, 20, 476, 760, 198, 20);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.font = '700 30px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    const sideColor = trade.trade.outcomeIndex === 0 ? '#22C55E' : '#EF4444';
    ctx.fillText(`◉ ${trade.trade.side === 'BUY' ? 'Buy' : 'Sell'} ${trade.trade.outcome}`, 44, 528);

    const rows = [
      ['Amount', formatUsd(trade.trade.usdcSize)],
      ['Price', formatPriceCents(trade.trade.price)],
      ['Shares', new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(trade.trade.size || trade.trade.usdcSize / Math.max(trade.trade.price, 0.01))],
      ['To win', `${formatUsd(trade.potentialWin)} (${formatMultiplier(trade.multiplier)})`],
    ];

    ctx.font = '600 24px Inter, Arial, sans-serif';
    ctx.fillStyle = sideColor;
    ctx.fillRect(44, 542, 6, 102);
    ctx.fillStyle = '#E2E8F0';
    rows.forEach(([label, value], index) => {
      const y = 578 + index * 28;
      ctx.fillText(`${label}:`, 64, y);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(value, 180, y);
      ctx.fillStyle = '#E2E8F0';
    });
  }

  private drawTopHolderSection(ctx: any, trade: EnrichedTrade, cardBg: string) {
    roundedRect(ctx, 20, 694, 760, 104, 20);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.font = '600 24px Inter, Arial, sans-serif';
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(`👥 ${trade.holderStats.topHoldersOnSide}/${trade.holderStats.totalTopHolders} Top Holders on ${trade.holderStats.side}`, 44, 740);
    ctx.fillText(`🐋 ${trade.holderStats.whalesInMarket} Whales · 🕵️ ${trade.holderStats.insidersInMarket} Insiders in market`, 44, 776);
  }

  private drawTraderSection(ctx: any, trade: EnrichedTrade, cardBg: string) {
    roundedRect(ctx, 20, 818, 760, 218, 20);
    ctx.fillStyle = cardBg;
    ctx.fill();

    const displayName = trade.trade.pseudonym || trade.trade.name || trade.trade.proxyWallet.slice(0, 8);
    const badgeText = trade.traderTypes.map((type) => `${TRADER_TYPE_META[type].emoji} ${TRADER_TYPE_META[type].label}`).join(' · ');

    ctx.font = '700 28px Inter, Arial, sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(`🐳 Trader: ${truncateText(displayName, 30)}`, 44, 866);

    const rows = [
      ['Positions', formatCompactUsd(trade.traderStats.totalPositionsValue)],
      ['Win Rate', trade.traderStats.winRateLabel],
      ['Realized P/L', formatSignedUsd(trade.traderStats.totalRealizedPnl)],
      ['Portfolio', formatCompactUsd(trade.traderStats.portfolioValue)],
    ];
    ctx.font = '600 24px Inter, Arial, sans-serif';
    rows.forEach(([label, value], index) => {
      const y = 906 + index * 32;
      ctx.fillStyle = '#CBD5E1';
      ctx.fillText(`${label}:`, 64, y);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(value, 216, y);
    });

    ctx.font = '600 22px Inter, Arial, sans-serif';
    ctx.fillStyle = '#A78BFA';
    ctx.fillText(`🏷️ ${trade.marketInfo.tags.slice(0, 3).join(', ') || 'Uncategorized'}`, 44, 1026);
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(truncateText(badgeText, 56), 430, 1026);
  }

  private drawFooter(ctx: any, trade: EnrichedTrade) {
    ctx.font = '500 20px Inter, Arial, sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText('@polyalerttrackerbot', 40, 1074);
    ctx.textAlign = 'right';
    ctx.fillText(`${formatCompactUsd(trade.marketInfo.volume)} volume · ${formatCompactUsd(trade.marketInfo.liquidity)} liquidity`, 760, 1074);
    ctx.textAlign = 'left';
  }

  private async loadMarketImage(canvasModule: CanvasModule, imageUrl: string): Promise<any | null> {
    if (!imageUrl) {
      return null;
    }
    const cached = this.imageCache.get(imageUrl);
    const imageBuffer = cached ?? await axios.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer', timeout: 15000 })
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
          return await this.dynamicImport('@napi-rs/canvas') as CanvasModule;
        } catch (napiError) {
          logger.warn('Falling back from @napi-rs/canvas', napiError);
          try {
            return await this.dynamicImport('canvas') as CanvasModule;
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
