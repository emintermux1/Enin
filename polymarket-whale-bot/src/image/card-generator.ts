import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'
import { LRUCache } from 'lru-cache'
import { EnrichedTrade, TraderType } from '../types'
import { getTradeTypeLabel } from '../classifier/trader-classifier'
import {
  formatMultiplier,
  formatPriceCents,
  formatResolveDate,
  formatUsd,
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

const LABEL_COLORS: Record<TraderType, string> = {
  WHALE: '#60a5fa',
  INSIDER: '#f59e0b',
  TOP_HOLDER: '#a78bfa',
  CONVICTION_BUILD: '#f87171',
}

function roundedRect(
  ctx: any,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function fillRoundedRect(
  ctx: any,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string
) {
  roundedRect(ctx, x, y, width, height, radius)
  ctx.fillStyle = fillStyle
  ctx.fill()
}

function wrapText(
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
    if (lastLine !== lines[maxLines - 1]) {
      lines[maxLines - 1] = `${lastLine}…`
    }
  }

  return lines
}

function fitFontSize(
  ctx: any,
  text: string,
  maxWidth: number,
  startingSize: number,
  minSize: number,
  fontWeight = 600
): number {
  for (let size = startingSize; size >= minSize; size -= 1) {
    ctx.font = `${fontWeight} ${size}px Inter, Arial, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) {
      return size
    }
  }
  return minSize
}

export class CardGenerator {
  private modulePromise: Promise<CanvasModule | null> | null = null
  private readonly imageCache = new LRUCache<string, Buffer>({
    max: 100,
    ttl: 1000 * 60 * 60 * 6,
  })
  private fontsReady = false
  // eslint-disable-next-line no-new-func
  private readonly dynamicImport = new Function(
    'specifier',
    'return import(specifier)'
  ) as (specifier: string) => Promise<any>

  async generateCard(trade: EnrichedTrade): Promise<Buffer | null> {
    const canvasModule = await this.getCanvasModule()
    if (!canvasModule) {
      return null
    }

    this.ensureFonts(canvasModule)

    const canvas = canvasModule.createCanvas(1280, 720)
    const ctx = canvas.getContext('2d')
    const cardX = 24
    const cardY = 24
    const cardWidth = 1232
    const cardHeight = 672
    const cardRadius = 34
    const textLeftX = 76
    const textMaxWidth = 620
    const textRightX = textLeftX + textMaxWidth
    const barY = 530
    const barHeight = cardY + cardHeight - barY
    const question = trade.marketInfo.question || trade.trade.title
    const displayName =
      trade.trade.name ||
      trade.trade.pseudonym ||
      trade.trade.proxyWallet.slice(0, 10)
    const side = trade.trade.side === 'BUY' ? 'Buy' : 'Sell'
    const action = trade.trade.side === 'BUY' ? 'BUY' : 'SELL'
    const outcome = trade.trade.outcome || String(trade.trade.outcomeIndex)
    const badgeColor = trade.trade.side === 'BUY' ? '#22c55e' : '#ef4444'
    const badgeTextColor = trade.trade.side === 'BUY' ? '#071014' : '#ffffff'
    const label = getTradeTypeLabel(trade.primaryType, trade.trade.side)
    const labelColor = LABEL_COLORS[trade.primaryType]
    const riskColor = trade.risk.color
    const riskBadgeBg = `${riskColor}33`
    const titleLineHeight = 52

    ctx.fillStyle = '#060913'
    ctx.fillRect(0, 0, 1280, 720)

    fillRoundedRect(
      ctx,
      cardX,
      cardY,
      cardWidth,
      cardHeight,
      cardRadius,
      '#0b1220'
    )

    const heroImage = await this.loadMarketImage(
      canvasModule,
      trade.marketInfo.image || trade.trade.icon
    )
    ctx.save()
    roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius)
    ctx.clip()

    if (heroImage) {
      this.drawCoverImage(ctx, heroImage, cardX, cardY, cardWidth, cardHeight)
    } else {
      const fallback = ctx.createLinearGradient(
        cardX,
        cardY,
        cardX + cardWidth,
        cardY + cardHeight
      )
      fallback.addColorStop(0, '#152235')
      fallback.addColorStop(0.5, '#0f1728')
      fallback.addColorStop(1, '#1f2937')
      ctx.fillStyle = fallback
      ctx.fillRect(cardX, cardY, cardWidth, cardHeight)
    }

    const textOverlay = ctx.createLinearGradient(cardX, 0, cardX + cardWidth, 0)
    textOverlay.addColorStop(0, 'rgba(6,9,19,0.95)')
    textOverlay.addColorStop(0.35, 'rgba(6,9,19,0.88)')
    textOverlay.addColorStop(0.55, 'rgba(6,9,19,0.55)')
    textOverlay.addColorStop(0.75, 'rgba(6,9,19,0.20)')
    textOverlay.addColorStop(1, 'rgba(6,9,19,0.10)')
    ctx.fillStyle = textOverlay
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight)

    const vignette = ctx.createLinearGradient(0, cardY, 0, cardY + cardHeight)
    vignette.addColorStop(0, 'rgba(0,0,0,0.15)')
    vignette.addColorStop(0.5, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0,0,0,0.25)')
    ctx.fillStyle = vignette
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight)

    ctx.fillStyle = 'rgba(6,12,21,0.92)'
    ctx.fillRect(cardX, barY, cardWidth, barHeight)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(cardX, barY, cardWidth, 1)

    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '1.5px'
    }
    ctx.font = '700 24px Inter, Arial, sans-serif'
    ctx.fillStyle = labelColor
    ctx.fillText(label, textLeftX, 78)
    const labelWidth = ctx.measureText(label).width
    if (trade.isFreshWallet) {
      ctx.font = '700 18px Inter, Arial, sans-serif'
      ctx.fillStyle = '#22c55e'
      const freshX = textLeftX + labelWidth + 20
      ctx.fillText('• NEW WALLET', freshX, 78)
    }
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '0px'
    }

    ctx.font = '700 16px Inter, Arial, sans-serif'
    const riskText = trade.risk.level
    const riskBadgeWidth = ctx.measureText(riskText).width + 24
    const riskBadgeHeight = 30
    const riskBadgeX = textRightX - riskBadgeWidth
    const riskBadgeY = 56
    fillRoundedRect(
      ctx,
      riskBadgeX,
      riskBadgeY,
      riskBadgeWidth,
      riskBadgeHeight,
      15,
      riskBadgeBg
    )
    ctx.fillStyle = riskColor
    ctx.textBaseline = 'middle'
    ctx.fillText(riskText, riskBadgeX + 12, riskBadgeY + riskBadgeHeight / 2)
    ctx.textBaseline = 'alphabetic'

    const scoreBadges = [
      trade.insiderScore && trade.insiderScore.score >= 60
        ? { text: 'INSIDER', color: '#f59e0b', background: '#f59e0b33' }
        : null,
      trade.unusualScore && trade.unusualScore.score >= 50
        ? { text: 'UNUSUAL', color: '#fb7185', background: '#fb718533' }
        : null,
    ].filter(
      (badge): badge is { text: string; color: string; background: string } =>
        Boolean(badge)
    )
    let scoreBadgeCursorX = riskBadgeX - 12
    ctx.font = '700 14px Inter, Arial, sans-serif'
    for (const badge of scoreBadges.reverse()) {
      const badgeWidth = ctx.measureText(badge.text).width + 24
      const badgeHeight = 28
      const badgeX = scoreBadgeCursorX - badgeWidth
      fillRoundedRect(
        ctx,
        badgeX,
        riskBadgeY + 1,
        badgeWidth,
        badgeHeight,
        14,
        badge.background
      )
      ctx.fillStyle = badge.color
      ctx.textBaseline = 'middle'
      ctx.fillText(badge.text, badgeX + 12, riskBadgeY + riskBadgeHeight / 2)
      ctx.textBaseline = 'alphabetic'
      scoreBadgeCursorX = badgeX - 10
    }

    ctx.font = '800 44px Inter, Arial, sans-serif'
    ctx.fillStyle = '#f8fafc'
    const titleLines = wrapText(ctx, question, textMaxWidth, 3)
    const titleY = 148
    titleLines.forEach((line, index) => {
      ctx.fillText(line, textLeftX, titleY + index * titleLineHeight)
    })

    const lastTitleY = titleY + (titleLines.length - 1) * titleLineHeight
    const subtitleY = lastTitleY + 52
    ctx.font = '600 28px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(226,232,240,0.82)'
    ctx.fillText(
      `${side} ${outcome} · Resolves ${formatResolveDate(trade.marketInfo.endDate)}`,
      textLeftX,
      subtitleY
    )

    ctx.fillStyle = '#f8fafc'
    ctx.font = '800 64px Inter, Arial, sans-serif'
    const amountText = formatUsd(trade.trade.usdcSize)
    const amountY = 618
    ctx.fillText(amountText, textLeftX, amountY)
    const amountWidth = ctx.measureText(amountText).width

    ctx.font = '800 22px Inter, Arial, sans-serif'
    const actionBadgeWidth = ctx.measureText(action).width + 28
    const actionBadgeHeight = 36
    const actionBadgeX = textLeftX + amountWidth + 20
    const actionBadgeY = 592
    fillRoundedRect(
      ctx,
      actionBadgeX,
      actionBadgeY,
      actionBadgeWidth,
      actionBadgeHeight,
      18,
      badgeColor
    )
    ctx.fillStyle = badgeTextColor
    ctx.textBaseline = 'middle'
    ctx.fillText(
      action,
      actionBadgeX + 14,
      actionBadgeY + actionBadgeHeight / 2
    )
    ctx.textBaseline = 'alphabetic'

    const infoParts = [
      `at ${formatPriceCents(trade.trade.price)}`,
      `Win ${formatUsd(trade.potentialWin)}`,
    ]
    if (trade.traderStats.bestWinAmount && trade.traderStats.bestWinAmount > 0) {
      infoParts.push(`Best ${formatUsd(trade.traderStats.bestWinAmount)}`)
    }
    infoParts.push(formatMultiplier(trade.multiplier))
    if (trade.traderStats.bestWinStreak) {
      infoParts.push(`Streak: ${trade.traderStats.bestWinStreak}`)
    }
    infoParts.push(truncateText(displayName, 16))
    const infoText = infoParts.join('     ')
    const infoMaxWidth = 1208 - (actionBadgeX + actionBadgeWidth + 28)
    const infoFontSize = fitFontSize(ctx, infoText, infoMaxWidth, 28, 20, 600)
    ctx.font = `600 ${infoFontSize}px Inter, Arial, sans-serif`
    ctx.fillStyle = 'rgba(241,245,249,0.7)'
    ctx.textAlign = 'right'
    ctx.fillText(infoText, 1208, 620)
    ctx.textAlign = 'left'
    ctx.restore()

    this.applyGrain(ctx, 1280, 720, 8)

    return this.canvasToBuffer(canvas)
  }

  async generateCompactCard(trade: EnrichedTrade): Promise<Buffer | null> {
    return this.generateCard(trade)
  }

  async saveSampleCard(
    trade: EnrichedTrade,
    outputPath: string
  ): Promise<boolean> {
    const card = await this.generateCard(trade)
    if (!card) {
      return false
    }
    await fs.promises.writeFile(outputPath, card)
    return true
  }

  private drawCoverImage(
    ctx: any,
    img: any,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) {
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

  private applyGrain(ctx: any, width: number, height: number, amount: number) {
    try {
      const imageData = ctx.getImageData(0, 0, width, height)
      const data = imageData.data
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * amount * 2
        data[i] = Math.max(0, Math.min(255, data[i] + noise))
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise))
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise))
      }
      ctx.putImageData(imageData, 0, 0)
    } catch {
      return
    }
  }

  private canvasToBuffer(canvas: any): Buffer | null {
    if (typeof canvas.encode === 'function') {
      return canvas.encode('png')
    }
    if (typeof canvas.toBuffer === 'function') {
      return canvas.toBuffer('image/png')
    }
    return null
  }

  private async loadMarketImage(
    canvasModule: CanvasModule,
    imageUrl: string
  ): Promise<any | null> {
    if (!imageUrl) {
      return null
    }
    const cached = this.imageCache.get(imageUrl)
    const imageBuffer =
      cached ??
      (await axios
        .get<ArrayBuffer>(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
        })
        .then((response) => Buffer.from(response.data))
        .catch((error) => {
          logger.warn(`Failed to download market image ${imageUrl}`, error)
          return null
        }))
    if (!imageBuffer) {
      return null
    }
    if (!cached) {
      this.imageCache.set(imageUrl, imageBuffer)
    }
    return canvasModule.loadImage(imageBuffer).catch((error) => {
      logger.warn(`Failed to decode market image ${imageUrl}`, error)
      return null
    })
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
    const fonts = [
      ['Inter-Regular.ttf', 'Inter'],
      ['Inter-SemiBold.ttf', 'Inter'],
      ['Inter-Bold.ttf', 'Inter'],
    ] as const
    const fontDir = path.resolve(process.cwd(), 'assets/fonts')
    for (const [file, family] of fonts) {
      const fontPath = path.join(fontDir, file)
      if (!fs.existsSync(fontPath)) {
        continue
      }
      try {
        if (canvasModule.GlobalFonts?.registerFromPath) {
          canvasModule.GlobalFonts.registerFromPath(fontPath, family)
        } else if (canvasModule.registerFont) {
          canvasModule.registerFont(fontPath, { family })
        }
      } catch (error) {
        logger.warn(`Failed to register font ${fontPath}`, error)
      }
    }
    this.fontsReady = true
  }
}
