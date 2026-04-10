import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'
import { LRUCache } from 'lru-cache'
import { EnrichedTrade, ResolutionAlert, TraderType } from '../types'
import { getTradeTypeLabel } from '../classifier/trader-classifier'
import {
  formatCompactUsd,
  formatMultiplier,
  formatPriceCents,
  formatResolveDate,
  formatSignedUsd,
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
  SMART_MONEY: '#22c55e',
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

function formatShares(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCalledAgo(daysAgo: number): string {
  if (daysAgo <= 0) {
    return 'Called today'
  }
  if (daysAgo === 1) {
    return 'Called 1 day ago'
  }
  return `Called ${daysAgo} days ago`
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
    const priceMomentum =
      trade.priceMomentum && Math.abs(trade.priceMomentum.changePercent) >= 10
        ? trade.priceMomentum
        : null
    const label = getTradeTypeLabel(
      trade.primaryType,
      trade.trade.side,
      trade.isFreshWallet,
      trade.risk.level
    )
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

    const infoParts = [`Win ${formatUsd(trade.potentialWin)}`]
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
    const priceLabel = `at ${formatPriceCents(trade.trade.price)}`
    const momentumLabel = priceMomentum
      ? ` | ${priceMomentum.direction === 'up' ? '↑' : '↓'}${Math.abs(priceMomentum.changePercent)}% ${priceMomentum.periodLabel}`
      : ''
    const fullInfoText = `${priceLabel}${momentumLabel}${infoText ? `     ${infoText}` : ''}`
    const infoFontSize = fitFontSize(ctx, fullInfoText, infoMaxWidth, 28, 20, 600)
    ctx.font = `600 ${infoFontSize}px Inter, Arial, sans-serif`
    const segments = [
      { text: priceLabel, color: 'rgba(241,245,249,0.7)' },
      ...(momentumLabel
        ? [{
            text: momentumLabel,
            color: priceMomentum?.direction === 'up' ? '#4ade80' : '#ef4444',
          }]
        : []),
      ...(infoText
        ? [{ text: `     ${infoText}`, color: 'rgba(241,245,249,0.7)' }]
        : []),
    ]
    const totalInfoWidth = segments.reduce(
      (width, segment) => width + ctx.measureText(segment.text).width,
      0
    )
    let infoCursorX = 1208 - totalInfoWidth
    for (const segment of segments) {
      ctx.fillStyle = segment.color
      ctx.fillText(segment.text, infoCursorX, 620)
      infoCursorX += ctx.measureText(segment.text).width
    }
    ctx.restore()

    this.applyGrain(ctx, 1280, 720, 8)

    return this.canvasToBuffer(canvas)
  }

  async generatePnlCard(alert: ResolutionAlert): Promise<Buffer | null> {
    const canvasModule = await this.getCanvasModule()
    if (!canvasModule) {
      return null
    }

    this.ensureFonts(canvasModule)

    const canvas = canvasModule.createCanvas(1280, 720)
    const ctx = canvas.getContext('2d')
    const palette = alert.won
      ? {
          primary: '#22c55e',
          secondary: '#16a34a',
          glow: 'rgba(34,197,94,0.28)',
          panel: '#08140f',
          chip: 'rgba(34,197,94,0.14)',
        }
      : {
          primary: '#ef4444',
          secondary: '#dc2626',
          glow: 'rgba(239,68,68,0.26)',
          panel: '#18090b',
          chip: 'rgba(239,68,68,0.14)',
        }
    const question = alert.marketQuestion
    const pnlText = formatSignedUsd(alert.pnl)
    const resultLabel = alert.won ? 'Won' : 'Lost'
    const outcomeSummary = `${alert.outcome} ${alert.won ? '✅' : '❌'}`
    const traderLabel = truncateText(alert.traderName, 26)
    const originalLabel = truncateText(alert.originalAlertLabel, 22)

    const background = ctx.createLinearGradient(0, 0, 1280, 720)
    background.addColorStop(0, '#04070d')
    background.addColorStop(0.45, '#07110c')
    background.addColorStop(1, '#020406')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 1280, 720)

    const aura = ctx.createRadialGradient(960, 160, 80, 960, 160, 540)
    aura.addColorStop(0, palette.glow)
    aura.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = aura
    ctx.fillRect(0, 0, 1280, 720)

    const sideAura = ctx.createRadialGradient(180, 620, 40, 180, 620, 420)
    sideAura.addColorStop(0, 'rgba(255,255,255,0.08)')
    sideAura.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sideAura
    ctx.fillRect(0, 0, 1280, 720)

    fillRoundedRect(ctx, 28, 28, 1224, 664, 36, 'rgba(255,255,255,0.04)')
    fillRoundedRect(ctx, 44, 44, 1192, 632, 30, palette.panel)

    const panelGradient = ctx.createLinearGradient(44, 44, 1236, 676)
    panelGradient.addColorStop(0, 'rgba(255,255,255,0.03)')
    panelGradient.addColorStop(0.55, 'rgba(255,255,255,0.015)')
    panelGradient.addColorStop(1, 'rgba(255,255,255,0.01)')
    ctx.fillStyle = panelGradient
    fillRoundedRect(ctx, 44, 44, 1192, 632, 30, ctx.fillStyle as string)

    fillRoundedRect(ctx, 74, 76, 260, 44, 22, palette.chip)
    ctx.font = '800 22px Inter, Arial, sans-serif'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText('✅ MARKET RESOLVED', 96, 105)

    fillRoundedRect(ctx, 950, 78, 214, 42, 21, 'rgba(255,255,255,0.06)')
    ctx.font = '700 20px Inter, Arial, sans-serif'
    ctx.fillStyle = '#dbe4ee'
    ctx.textAlign = 'center'
    ctx.fillText(outcomeSummary, 1057, 106)
    ctx.textAlign = 'left'

    ctx.font = '800 44px Inter, Arial, sans-serif'
    ctx.fillStyle = '#f8fafc'
    const questionLines = wrapText(ctx, question, 1060, 2)
    let y = 170
    questionLines.forEach((line) => {
      ctx.fillText(line, 78, y)
      y += 52
    })

    y += 24
    ctx.font = '700 22px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(226,232,240,0.82)'
    ctx.fillText(`${resultLabel} on ${alert.outcome}`, 82, y)

    y += 16
    const pnlFontSize = fitFontSize(ctx, pnlText, 700, 88, 64, 800)
    ctx.font = `800 ${pnlFontSize}px Inter, Arial, sans-serif`
    ctx.fillStyle = alert.won ? '#4ade80' : '#f87171'
    y += pnlFontSize
    ctx.fillText(pnlText, 74, y)

    y += 40
    const panelHeight = 130
    const panelY = Math.max(y, 500)

    fillRoundedRect(ctx, 76, panelY, 1128, panelHeight, 28, 'rgba(255,255,255,0.04)')
    ctx.fillStyle = palette.primary
    ctx.fillRect(76, panelY, 8, panelHeight)

    const statLabels = [
      { label: 'Trader', value: traderLabel },
      { label: 'Original', value: originalLabel },
      { label: 'Shares', value: formatShares(alert.shares) },
      { label: 'Called', value: formatCalledAgo(alert.daysAgo) },
    ]

    const statColumns = [112, 398, 684, 936]
    ctx.font = '700 16px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,163,184,0.9)'
    statLabels.forEach((stat, index) => {
      ctx.fillText(stat.label.toUpperCase(), statColumns[index], panelY + 36)
    })

    ctx.font = '700 26px Inter, Arial, sans-serif'
    ctx.fillStyle = '#f8fafc'
    statLabels.forEach((stat, index) => {
      const x = statColumns[index]
      const maxWidth = index === 3 ? 220 : 230
      const size = fitFontSize(ctx, stat.value, maxWidth, 26, 18, 700)
      ctx.font = `700 ${size}px Inter, Arial, sans-serif`
      ctx.fillText(stat.value, x, panelY + 70)
    })

    ctx.font = '600 20px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(226,232,240,0.84)'
    ctx.fillText(
      `${formatUsd(alert.entryAmount)} at ${formatPriceCents(alert.entryPrice)} · ${formatMultiplier(alert.multiplier)} payout path`,
      112,
      panelY + 106
    )

    this.applyGrain(ctx, 1280, 720, 10)

    return this.canvasToBuffer(canvas)
  }

  async generateLeaderboardCard(): Promise<Buffer | null> {
    const imagePath = path.resolve(__dirname, '../../assets/leaderboard-bg.png')
    try {
      return await fs.promises.readFile(imagePath)
    } catch {
      return null
    }
  }

  async generateHeatmapCard(
    markets: Array<{
      marketQuestion: string
      conditionId: string
      eventSlug?: string
      tradeCount: number
      totalVolume: number
      uniqueWallets: number
    }>
  ): Promise<Buffer | null> {
    const canvasModule = await this.getCanvasModule()
    if (!canvasModule) {
      return null
    }

    this.ensureFonts(canvasModule)

    const canvas = canvasModule.createCanvas(1280, 720)
    const ctx = canvas.getContext('2d')
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']

    const background = ctx.createLinearGradient(0, 0, 1280, 720)
    background.addColorStop(0, '#050916')
    background.addColorStop(0.45, '#08101d')
    background.addColorStop(1, '#030711')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 1280, 720)

    const glow = ctx.createRadialGradient(1060, 120, 50, 1060, 120, 360)
    glow.addColorStop(0, 'rgba(96,165,250,0.22)')
    glow.addColorStop(1, 'rgba(96,165,250,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, 1280, 720)

    fillRoundedRect(ctx, 28, 28, 1224, 664, 36, 'rgba(255,255,255,0.04)')
    fillRoundedRect(ctx, 44, 44, 1192, 632, 30, '#0b1220')

    const panelGradient = ctx.createLinearGradient(44, 44, 1236, 676)
    panelGradient.addColorStop(0, 'rgba(255,255,255,0.035)')
    panelGradient.addColorStop(0.5, 'rgba(255,255,255,0.018)')
    panelGradient.addColorStop(1, 'rgba(255,255,255,0.012)')
    fillRoundedRect(ctx, 44, 44, 1192, 632, 30, panelGradient as unknown as string)

    fillRoundedRect(ctx, 76, 78, 368, 46, 23, 'rgba(59,130,246,0.16)')
    ctx.font = '800 24px Inter, Arial, sans-serif'
    ctx.fillStyle = '#bfdbfe'
    ctx.fillText('🔥 MARKET HEATMAP — Last 12h', 98, 109)

    fillRoundedRect(ctx, 998, 80, 162, 42, 21, 'rgba(255,255,255,0.06)')
    ctx.font = '700 18px Inter, Arial, sans-serif'
    ctx.fillStyle = '#dbeafe'
    ctx.textAlign = 'center'
    ctx.fillText('TOP 5 MARKETS', 1079, 107)
    ctx.textAlign = 'left'

    ctx.font = '700 16px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,163,184,0.92)'
    ctx.fillText('MARKET', 106, 158)
    ctx.fillText('TRADES', 810, 158)
    ctx.fillText('VOLUME', 930, 158)
    ctx.fillText('WHALES', 1084, 158)

    const startY = 182
    const rowHeight = 92

    markets.slice(0, 5).forEach((market, index) => {
      const y = startY + index * rowHeight
      const medal = medals[index] || `${index + 1}.`
      const rowBg = index === 0 ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.035)'
      const accent = index === 0 ? '#60a5fa' : '#1d4ed8'

      fillRoundedRect(ctx, 78, y, 1124, 72, 24, rowBg)
      ctx.fillStyle = accent
      ctx.fillRect(78, y, 8, 72)

      ctx.font = '800 34px Inter, Arial, sans-serif'
      ctx.fillStyle = '#f8fafc'
      ctx.fillText(medal, 108, y + 47)

      ctx.font = '700 28px Inter, Arial, sans-serif'
      const title = truncateText(market.marketQuestion || market.conditionId, 44)
      ctx.fillText(title, 172, y + 36)

      ctx.font = '600 18px Inter, Arial, sans-serif'
      ctx.fillStyle = 'rgba(191,219,254,0.82)'
      const slug = market.eventSlug || market.conditionId
      ctx.fillText(truncateText(`polymarket.com/event/${slug}`, 44), 172, y + 60)

      ctx.font = '800 26px Inter, Arial, sans-serif'
      ctx.fillStyle = '#f8fafc'
      ctx.textAlign = 'center'
      ctx.fillText(String(market.tradeCount), 846, y + 46)
      ctx.fillText(formatCompactUsd(Number(market.totalVolume || 0)), 988, y + 46)
      ctx.fillText(String(market.uniqueWallets), 1118, y + 46)
      ctx.textAlign = 'left'
    })

    fillRoundedRect(ctx, 76, 614, 1128, 36, 18, 'rgba(255,255,255,0.04)')
    ctx.font = '600 18px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(226,232,240,0.78)'
    ctx.fillText(`Updated ${timestamp} UTC`, 98, 637)
    ctx.textAlign = 'right'
    ctx.fillText('Whale activity ranked by 12h volume', 1180, 637)
    ctx.textAlign = 'left'

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
