import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'
import { LRUCache } from 'lru-cache'
import { MarketData } from '../types'
import {
  formatCompactUsd,
  formatProbability,
  formatTimestamp,
  truncateText,
} from '../utils/formatter'
import { logger } from '../utils/logger'

type CanvasModule = {
  createCanvas: (width: number, height: number) => any
  loadImage: (source: Buffer | string) => Promise<any>
  registerFont?: (
    path: string,
    options: { family: string; weight?: string }
  ) => void
  GlobalFonts?: { registerFromPath: (path: string, family: string) => boolean }
}

interface OutcomeRow {
  label: string
  probability: number
  colorStart: string
  colorEnd: string
  changeText?: string
}

interface CardVariant {
  header: string
  accentStart: string
  accentEnd: string
  eyebrow?: string
  headline: string
  market?: MarketData
  heroBadge?: string
  volumeBadge?: string
  resolutionLabel?: string
  changeLabel?: string
}

const OUTCOME_COLORS = [
  ['#22c55e', '#16a34a'],
  ['#ef4444', '#dc2626'],
  ['#3b82f6', '#2563eb'],
  ['#f59e0b', '#d97706'],
  ['#8b5cf6', '#7c3aed'],
  ['#ec4899', '#db2777'],
  ['#14b8a6', '#0f766e'],
] as const

export class MarketCardGenerator {
  private modulePromise: Promise<CanvasModule | null> | null = null
  private readonly imageCache = new LRUCache<string, Buffer>({
    max: 128,
    ttl: 1000 * 60 * 60 * 6,
  })
  private fontsReady = false
  // eslint-disable-next-line no-new-func
  private readonly dynamicImport = new Function(
    'specifier',
    'return import(specifier)'
  ) as (specifier: string) => Promise<any>

  async generateMarketCard(market: MarketData): Promise<Buffer> {
    return this.renderCard({
      header: '📊 Polymarket News',
      accentStart: '#2563eb',
      accentEnd: '#06b6d4',
      eyebrow: market.tags[0] || 'Polymarket',
      headline: market.question,
      market,
      volumeBadge: `${formatCompactUsd(market.volume24hr || market.volume)} Volume`,
    })
  }

  async generateBreakingNewsCard(
    headline: string,
    market?: MarketData
  ): Promise<Buffer> {
    return this.renderCard({
      header: '🚨 BREAKING',
      accentStart: '#ef4444',
      accentEnd: '#f97316',
      eyebrow: market?.tags[0] || 'Breaking News',
      headline,
      market,
      heroBadge: 'JUST IN',
      volumeBadge: market
        ? `${formatCompactUsd(market.volume24hr || market.volume)} Volume`
        : 'Live update',
    })
  }

  async generateNewMarketCard(market: MarketData): Promise<Buffer> {
    return this.renderCard({
      header: '🆕 NEW MARKET',
      accentStart: '#06b6d4',
      accentEnd: '#8b5cf6',
      eyebrow: market.tags[0] || 'Fresh market',
      headline: market.question,
      market,
      heroBadge: 'OPENING ODDS',
      volumeBadge: `${formatCompactUsd(market.volume)} Matched`,
    })
  }

  async generatePriceMoverCard(
    market: MarketData,
    change: number,
    direction: 'up' | 'down'
  ): Promise<Buffer> {
    return this.renderCard({
      header: direction === 'up' ? '📈 PRICE SURGE' : '📉 PRICE DROP',
      accentStart: direction === 'up' ? '#22c55e' : '#ef4444',
      accentEnd: direction === 'up' ? '#14b8a6' : '#f97316',
      eyebrow: market.tags[0] || 'Fast market move',
      headline: market.question,
      market,
      heroBadge: 'MOMENTUM',
      changeLabel: `${direction === 'up' ? '📈 +' : '📉 -'}${Math.round(change)}%`,
      volumeBadge: `${formatCompactUsd(market.volume24hr || market.volume)} Volume`,
    })
  }

  async generateResolutionCard(
    market: MarketData,
    resolvedOutcome: string
  ): Promise<Buffer> {
    return this.renderCard({
      header: '✅ RESOLVED',
      accentStart: '#22c55e',
      accentEnd: '#14b8a6',
      eyebrow: market.tags[0] || 'Market result',
      headline: market.question,
      market,
      resolutionLabel: resolvedOutcome,
      volumeBadge: `${formatCompactUsd(market.volume)} Final volume`,
    })
  }

  private async renderCard(variant: CardVariant): Promise<Buffer> {
    const canvasModule = await this.getCanvasModule()
    if (!canvasModule) {
      throw new Error('Canvas module unavailable')
    }

    this.ensureFonts(canvasModule)

    const canvas = canvasModule.createCanvas(1280, 720)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0d1117'
    ctx.fillRect(0, 0, 1280, 720)

    const background = ctx.createLinearGradient(0, 0, 1280, 720)
    background.addColorStop(0, '#0d1117')
    background.addColorStop(0.55, '#111827')
    background.addColorStop(1, '#161b22')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 1280, 720)

    const accentGlow = ctx.createRadialGradient(1080, 80, 60, 1080, 80, 500)
    accentGlow.addColorStop(0, `${variant.accentStart}66`)
    accentGlow.addColorStop(0.45, `${variant.accentEnd}12`)
    accentGlow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = accentGlow
    ctx.fillRect(0, 0, 1280, 720)

    this.drawPanel(
      ctx,
      24,
      24,
      1232,
      672,
      34,
      'rgba(10,15,25,0.78)',
      'rgba(255,255,255,0.06)'
    )

    const marketImage = variant.market?.image
      ? await this.loadMarketImage(canvasModule, variant.market.image)
      : null
    const contentLeft = 64
    const contentTop = 58

    ctx.font = '700 28px Inter, Arial, sans-serif'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(variant.header, contentLeft, contentTop)

    this.drawBadge(
      ctx,
      contentLeft,
      86,
      variant.eyebrow || 'Polymarket',
      variant.accentStart,
      variant.accentEnd,
      '#f8fafc'
    )
    if (variant.volumeBadge) {
      const width = Math.max(
        170,
        ctx.measureText(variant.volumeBadge).width + 34
      )
      this.drawBadge(
        ctx,
        1280 - 64 - width,
        86,
        variant.volumeBadge,
        '#1f2937',
        '#111827',
        '#cbd5e1',
        width
      )
    }

    const heroY = 146
    let textX = contentLeft
    let textWidth = 1152

    if (marketImage) {
      const imageX = contentLeft
      const imageY = heroY
      const imageSize = 280
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 40
      ctx.shadowOffsetY = 18
      this.drawRoundedRect(ctx, imageX, imageY, imageSize, imageSize, 28)
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fill()
      ctx.clip()
      this.drawCoverImage(
        ctx,
        marketImage,
        imageX,
        imageY,
        imageSize,
        imageSize
      )
      ctx.restore()

      this.drawRoundedOutline(
        ctx,
        imageX,
        imageY,
        imageSize,
        imageSize,
        28,
        'rgba(255,255,255,0.10)'
      )
      textX = imageX + imageSize + 42
      textWidth = 1280 - textX - 72
    }

    if (variant.heroBadge) {
      this.drawBadge(
        ctx,
        textX,
        heroY + 6,
        variant.heroBadge,
        `${variant.accentStart}88`,
        `${variant.accentEnd}88`,
        '#ffffff'
      )
    }

    ctx.font = '800 18px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(191,219,254,0.92)'
    const eyebrowText = variant.market?.endDate
      ? `Ends ${truncateText(variant.market.endDate, 24)}`
      : 'Prediction market update'
    ctx.fillText(eyebrowText, textX, heroY + 74)

    ctx.font = '800 42px Inter, Arial, sans-serif'
    ctx.fillStyle = '#ffffff'
    const headlineLines = this.wrapText(ctx, variant.headline, textWidth, 3)
    headlineLines.forEach((line, index) => {
      ctx.fillText(line, textX, heroY + 138 + index * 52)
    })

    if (variant.changeLabel) {
      ctx.font = '800 30px Inter, Arial, sans-serif'
      ctx.fillStyle = variant.changeLabel.startsWith('+')
        ? '#4ade80'
        : '#f87171'
      ctx.fillText(variant.changeLabel, textX, heroY + 278)
    }

    if (variant.resolutionLabel) {
      ctx.font = '800 22px Inter, Arial, sans-serif'
      ctx.fillStyle = '#86efac'
      ctx.fillText(
        `Winning outcome: ${variant.resolutionLabel}`,
        textX,
        heroY + 278
      )
    } else if (variant.market) {
      const topIndex = this.getTopOutcomeIndex(variant.market.outcomePrices)
      const leader = variant.market.outcomes[topIndex] || 'Lead'
      const probability = variant.market.outcomePrices[topIndex] || 0
      ctx.font = '700 22px Inter, Arial, sans-serif'
      ctx.fillStyle = '#cbd5e1'
      ctx.fillText(
        `Leader: ${leader} ${formatProbability(probability)}`,
        textX,
        heroY + 278
      )
    }

    const divider = ctx.createLinearGradient(64, 0, 1216, 0)
    divider.addColorStop(0, 'rgba(255,255,255,0.09)')
    divider.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = divider
    ctx.fillRect(64, 478, 1152, 1)

    const outcomeRows = this.buildOutcomeRows(variant.market)
    ctx.font = '700 18px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,163,184,0.92)'
    ctx.fillText('Outcome probabilities', 64, 512)
    outcomeRows.forEach((row, index) => {
      this.drawOutcomeBar(ctx, row, 544 + index * 32, 1152)
    })

    ctx.font = '600 16px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,163,184,0.75)'
    ctx.fillText(formatTimestamp(Date.now()), 64, 688)
    ctx.textAlign = 'right'
    ctx.fillText('polymarket.com', 1216, 688)
    ctx.textAlign = 'left'

    this.drawGrainTexture(ctx, 1280, 720, 8)
    return this.canvasToBuffer(canvas)
  }

  private buildOutcomeRows(market?: MarketData): OutcomeRow[] {
    if (!market || market.outcomes.length === 0) {
      return [
        {
          label: 'No outcome data available',
          probability: 0,
          colorStart: '#334155',
          colorEnd: '#475569',
        },
      ]
    }
    return market.outcomes.slice(0, 5).map((outcome, index) => {
      const probability = market.outcomePrices[index] ?? 0
      const palette =
        outcome.toLowerCase() === 'yes'
          ? OUTCOME_COLORS[0]
          : outcome.toLowerCase() === 'no'
            ? OUTCOME_COLORS[1]
            : OUTCOME_COLORS[(index + 2) % OUTCOME_COLORS.length]
      return {
        label: outcome,
        probability,
        colorStart: palette[0],
        colorEnd: palette[1],
      }
    })
  }

  private getTopOutcomeIndex(prices: number[]): number {
    let bestIndex = 0
    let bestValue = -1
    prices.forEach((price, index) => {
      if (price > bestValue) {
        bestValue = price
        bestIndex = index
      }
    })
    return bestIndex
  }

  private drawPanel(
    ctx: any,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: string,
    stroke: string
  ) {
    this.drawRoundedRect(ctx, x, y, width, height, radius)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1
    ctx.stroke()
  }

  private drawBadge(
    ctx: any,
    x: number,
    y: number,
    text: string,
    startColor: string,
    endColor: string,
    textColor: string,
    forcedWidth?: number
  ) {
    ctx.save()
    ctx.font = '700 18px Inter, Arial, sans-serif'
    const width = forcedWidth ?? Math.max(120, ctx.measureText(text).width + 30)
    const gradient = ctx.createLinearGradient(x, y, x + width, y + 34)
    gradient.addColorStop(0, startColor)
    gradient.addColorStop(1, endColor)
    this.drawRoundedRect(ctx, x, y, width, 34, 17)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.fillStyle = textColor
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + 16, y + 17)
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
  }

  private drawRoundedOutline(
    ctx: any,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    color: string
  ) {
    ctx.save()
    this.drawRoundedRect(ctx, x, y, width, height, radius)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  private drawOutcomeBar(
    ctx: any,
    outcome: OutcomeRow,
    y: number,
    width: number
  ): void {
    const labelX = 64
    const probabilityX = 1136
    const barX = 64
    const barY = y + 10
    const barWidth = width
    const barHeight = 12

    ctx.font = '600 22px Inter, Arial, sans-serif'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(truncateText(outcome.label, 36), labelX, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = outcome.colorStart
    ctx.font = '800 24px Inter, Arial, sans-serif'
    ctx.fillText(formatProbability(outcome.probability), probabilityX, y)
    ctx.textAlign = 'left'

    this.drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 6)
    ctx.fillStyle = 'rgba(51,65,85,0.78)'
    ctx.fill()

    const fillWidth = Math.max(
      18,
      Math.min(barWidth, barWidth * outcome.probability)
    )
    const gradient = ctx.createLinearGradient(barX, 0, barX + fillWidth, 0)
    gradient.addColorStop(0, outcome.colorStart)
    gradient.addColorStop(1, outcome.colorEnd)
    this.drawRoundedRect(ctx, barX, barY, fillWidth, barHeight, 6)
    ctx.fillStyle = gradient
    ctx.fill()

    if (outcome.changeText) {
      ctx.font = '600 16px Inter, Arial, sans-serif'
      ctx.fillStyle = outcome.changeText.startsWith('+') ? '#4ade80' : '#f87171'
      ctx.fillText(outcome.changeText, 1152, y - 2)
    }
  }

  private wrapText(
    ctx: any,
    text: string,
    maxWidth: number,
    maxLines: number
  ): string[] {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let current = ''

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate
        continue
      }
      if (current) {
        lines.push(current)
      }
      current = word
      if (lines.length === maxLines - 1) {
        break
      }
    }

    if (current && lines.length < maxLines) {
      lines.push(current)
    }

    if (lines.length === maxLines) {
      let lastLine = lines[maxLines - 1] ?? ''
      while (
        ctx.measureText(`${lastLine}…`).width > maxWidth &&
        lastLine.length > 0
      ) {
        lastLine = lastLine.slice(0, -1).trimEnd()
      }
      lines[maxLines - 1] = `${lastLine}…`
    }

    return lines
  }

  private drawGrainTexture(
    ctx: any,
    width: number,
    height: number,
    alpha: number
  ): void {
    try {
      const imageData = ctx.getImageData(0, 0, width, height)
      const data = imageData.data
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * alpha * 2
        data[i] = Math.max(0, Math.min(255, data[i] + noise))
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise))
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise))
      }
      ctx.putImageData(imageData, 0, 0)
    } catch {
      return
    }
  }

  private drawRoundedRect(
    ctx: any,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + width, y, x + width, y + height, radius)
    ctx.arcTo(x + width, y + height, x, y + height, radius)
    ctx.arcTo(x, y + height, x, y, radius)
    ctx.arcTo(x, y, x + width, y, radius)
    ctx.closePath()
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    const cached = this.imageCache.get(url)
    if (cached) {
      return cached
    }
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 15_000,
      })
      const buffer = Buffer.from(response.data)
      this.imageCache.set(url, buffer)
      return buffer
    } catch (error) {
      logger.warn(`Failed to download image ${url}`, error)
      return null
    }
  }

  private async loadMarketImage(
    canvasModule: CanvasModule,
    url: string
  ): Promise<any | null> {
    const imageBuffer = await this.downloadImage(url)
    if (!imageBuffer) {
      return null
    }
    try {
      return await canvasModule.loadImage(imageBuffer)
    } catch (error) {
      logger.warn(`Failed to decode image ${url}`, error)
      return null
    }
  }

  private drawCoverImage(
    ctx: any,
    img: any,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void {
    const imgRatio = img.width / img.height
    const areaRatio = dw / dh
    let sx = 0
    let sy = 0
    let sw = img.width
    let sh = img.height

    if (imgRatio > areaRatio) {
      sw = img.height * areaRatio
      sx = (img.width - sw) / 2
    } else {
      sh = img.width / areaRatio
      sy = (img.height - sh) / 2
    }

    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  }

  private canvasToBuffer(canvas: any): Buffer {
    if (typeof canvas.encode === 'function') {
      return canvas.encode('png')
    }
    if (typeof canvas.toBuffer === 'function') {
      return canvas.toBuffer('image/png')
    }
    throw new Error('Canvas buffer export unavailable')
  }

  private async getCanvasModule(): Promise<CanvasModule | null> {
    if (!this.modulePromise) {
      this.modulePromise = (async () => {
        try {
          return (await this.dynamicImport('@napi-rs/canvas')) as CanvasModule
        } catch (napiError) {
          logger.warn('Falling back from @napi-rs/canvas', napiError)
          try {
            return (await this.dynamicImport('canvas')) as CanvasModule
          } catch (canvasError) {
            logger.error(
              'Canvas libraries unavailable; image posting disabled',
              canvasError
            )
            return null
          }
        }
      })()
    }
    return this.modulePromise
  }

  private ensureFonts(canvasModule: CanvasModule) {
    if (this.fontsReady) {
      return
    }
    const fonts = ['Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf']
    const fontDir = path.resolve(process.cwd(), 'assets/fonts')
    for (const file of fonts) {
      const fontPath = path.join(fontDir, file)
      if (!fs.existsSync(fontPath)) {
        continue
      }
      try {
        if (canvasModule.GlobalFonts?.registerFromPath) {
          canvasModule.GlobalFonts.registerFromPath(fontPath, 'Inter')
        } else if (canvasModule.registerFont) {
          canvasModule.registerFont(fontPath, { family: 'Inter' })
        }
      } catch (error) {
        logger.warn(`Failed to register font ${fontPath}`, error)
      }
    }
    this.fontsReady = true
  }
}
