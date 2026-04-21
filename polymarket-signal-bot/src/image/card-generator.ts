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

const BG_OUTER = '#050a08'
const BG_CARD = '#091a14'
const EMERALD = '#10b981'
const TEAL = '#14b8a6'
const AMBER = '#f59e0b'
const VIOLET = '#a78bfa'
const PINK = '#f472b6'
const SELL_RED = '#ef4444'

const LABEL_COLORS: Record<TraderType, string> = {
  WHALE: TEAL,
  INSIDER: AMBER,
  SMART_MONEY: EMERALD,
  TOP_HOLDER: VIOLET,
  CONVICTION_BUILD: PINK,
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
  fillStyle: any
) {
  roundedRect(ctx, x, y, width, height, radius)
  ctx.fillStyle = fillStyle
  ctx.fill()
}

function strokeRoundedRect(
  ctx: any,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeStyle: any,
  lineWidth = 1
) {
  roundedRect(ctx, x, y, width, height, radius)
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = lineWidth
  ctx.stroke()
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

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized
  const value = Number.parseInt(full, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export class CardGenerator {
  private modulePromise: Promise<CanvasModule | null> | null = null
  private readonly imageCache = new LRUCache<string, Buffer>({
    max: 100,
    ttl: 1000 * 60 * 60 * 6,
  })
  private fontsReady = false
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
    const badgeColor = trade.trade.side === 'BUY' ? EMERALD : SELL_RED
    const badgeTextColor = trade.trade.side === 'BUY' ? '#04120d' : '#ffffff'
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
    const riskColor = trade.risk.color || EMERALD
    const titleLineHeight = 52

    ctx.fillStyle = BG_OUTER
    ctx.fillRect(0, 0, 1280, 720)

    fillRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius, BG_CARD)

    const [heroImage, profileImage] = await Promise.all([
      this.loadMarketImage(canvasModule, trade.marketInfo.image || trade.trade.icon),
      this.loadMarketImage(canvasModule, trade.trade.profileImage),
    ])

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
      fallback.addColorStop(0, '#0d2a20')
      fallback.addColorStop(0.5, '#091a14')
      fallback.addColorStop(1, '#142f26')
      ctx.fillStyle = fallback
      ctx.fillRect(cardX, cardY, cardWidth, cardHeight)
    }

    const textOverlay = ctx.createLinearGradient(cardX, 0, cardX + cardWidth, 0)
    textOverlay.addColorStop(0, 'rgba(5,10,8,0.96)')
    textOverlay.addColorStop(0.35, 'rgba(5,10,8,0.90)')
    textOverlay.addColorStop(0.55, 'rgba(5,10,8,0.55)')
    textOverlay.addColorStop(0.75, 'rgba(5,10,8,0.18)')
    textOverlay.addColorStop(1, 'rgba(5,10,8,0.08)')
    ctx.fillStyle = textOverlay
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight)

    const vignette = ctx.createLinearGradient(0, cardY, 0, cardY + cardHeight)
    vignette.addColorStop(0, 'rgba(3,8,6,0.16)')
    vignette.addColorStop(0.55, 'rgba(3,8,6,0)')
    vignette.addColorStop(1, 'rgba(3,8,6,0.34)')
    ctx.fillStyle = vignette
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight)

    const topAccent = ctx.createLinearGradient(cardX, cardY, cardX + cardWidth, cardY)
    topAccent.addColorStop(0, EMERALD)
    topAccent.addColorStop(0.45, TEAL)
    topAccent.addColorStop(1, 'rgba(20,184,166,0.12)')
    ctx.fillStyle = topAccent
    ctx.fillRect(cardX, cardY, cardWidth, 3)

    ctx.fillStyle = EMERALD
    ctx.fillRect(cardX, cardY + cardRadius, 3, cardHeight - cardRadius * 2)

    const sepGradient = ctx.createLinearGradient(cardX, barY, cardX + cardWidth, barY)
    sepGradient.addColorStop(0, EMERALD)
    sepGradient.addColorStop(0.6, TEAL)
    sepGradient.addColorStop(1, 'rgba(20,184,166,0.1)')
    ctx.fillStyle = sepGradient
    ctx.fillRect(cardX, barY, cardWidth, 2)

    ctx.fillStyle = 'rgba(5,10,8,0.94)'
    ctx.fillRect(cardX, barY + 2, cardWidth, barHeight - 2)

    ctx.restore()

    strokeRoundedRect(
      ctx,
      cardX + 0.5,
      cardY + 0.5,
      cardWidth - 1,
      cardHeight - 1,
      cardRadius - 0.5,
      'rgba(255,255,255,0.05)',
      1
    )

    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '1.5px'
    }
    ctx.font = '700 24px Inter, Arial, sans-serif'
    ctx.fillStyle = labelColor
    ctx.fillText(label, textLeftX, 78)
    const labelWidth = ctx.measureText(label).width
    if (trade.isFreshWallet) {
      ctx.font = '700 18px Inter, Arial, sans-serif'
      ctx.fillStyle = '#5eead4'
      const freshX = textLeftX + labelWidth + 20
      ctx.fillText('• NEW WALLET', freshX, 78)
    }
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '0px'
    }

    ctx.font = '800 120px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(16,185,129,0.04)'
    ctx.textAlign = 'right'
    ctx.fillText('SIGNAL', cardX + cardWidth - 40, 160)
    ctx.textAlign = 'left'
    this.drawSignalWatermark(ctx, cardX + cardWidth - 108, 86)

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
      hexToRgba(labelColor, 0.16)
    )
    strokeRoundedRect(
      ctx,
      riskBadgeX + 0.5,
      riskBadgeY + 0.5,
      riskBadgeWidth - 1,
      riskBadgeHeight - 1,
      14.5,
      hexToRgba(riskColor, 0.42),
      1
    )
    ctx.fillStyle = riskColor
    ctx.textBaseline = 'middle'
    ctx.fillText(riskText, riskBadgeX + 12, riskBadgeY + riskBadgeHeight / 2)
    ctx.textBaseline = 'alphabetic'

    const scoreBadges = [
      trade.insiderScore && trade.insiderScore.score >= 60
        ? { text: 'INSIDER', color: AMBER, background: hexToRgba(AMBER, 0.2) }
        : null,
      trade.unusualScore && trade.unusualScore.score >= 50
        ? { text: 'UNUSUAL', color: PINK, background: hexToRgba(PINK, 0.2) }
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
    ctx.fillStyle = 'rgba(223,244,239,0.82)'
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
    if (
      trade.traderStats.bestWinAmount &&
      trade.traderStats.bestWinAmount > 0
    ) {
      infoParts.push(`Best ${formatUsd(trade.traderStats.bestWinAmount)}`)
    }
    infoParts.push(formatMultiplier(trade.multiplier))
    if (trade.traderStats.bestWinStreak) {
      infoParts.push(`Streak: ${trade.traderStats.bestWinStreak}`)
    }
    const infoText = infoParts.join('     ')

    const traderName = truncateText(displayName, profileImage ? 16 : 18)
    ctx.font = '700 24px Inter, Arial, sans-serif'
    const traderNameWidth = ctx.measureText(traderName).width
    const profileAvatarSize = profileImage ? 52 : 0
    const profileGap = profileImage ? 14 : 0
    const profileChipWidth = Math.ceil(32 + profileAvatarSize + profileGap + traderNameWidth)
    const profileChipX = cardX + cardWidth - 32 - profileChipWidth
    const infoMaxWidth = profileChipX - (actionBadgeX + actionBadgeWidth + 34)
    const priceLabel = `at ${formatPriceCents(trade.trade.price)}`
    const momentumLabel = priceMomentum
      ? ` | ${priceMomentum.direction === 'up' ? '↑' : '↓'}${Math.abs(priceMomentum.changePercent)}% ${priceMomentum.periodLabel}`
      : ''
    const fullInfoText = `${priceLabel}${momentumLabel}${infoText ? `     ${infoText}` : ''}`
    const infoFontSize = fitFontSize(
      ctx,
      fullInfoText,
      infoMaxWidth,
      28,
      20,
      600
    )
    ctx.font = `600 ${infoFontSize}px Inter, Arial, sans-serif`
    const segments = [
      { text: priceLabel, color: 'rgba(231,246,241,0.72)' },
      ...(momentumLabel
        ? [
            {
              text: momentumLabel,
              color: priceMomentum?.direction === 'up' ? '#34d399' : SELL_RED,
            },
          ]
        : []),
      ...(infoText
        ? [{ text: `     ${infoText}`, color: 'rgba(231,246,241,0.72)' }]
        : []),
    ]
    const totalInfoWidth = segments.reduce(
      (width, segment) => width + ctx.measureText(segment.text).width,
      0
    )
    let infoCursorX = Math.max(actionBadgeX + actionBadgeWidth + 34, profileChipX - totalInfoWidth - 22)
    for (const segment of segments) {
      ctx.fillStyle = segment.color
      ctx.fillText(segment.text, infoCursorX, 620)
      infoCursorX += ctx.measureText(segment.text).width
    }

    this.drawTraderIdentityChip(ctx, {
      x: profileChipX,
      y: 581,
      width: profileChipWidth,
      height: 56,
      name: traderName,
      profileImage,
    })

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
          primary: EMERALD,
          secondary: '#059669',
          glow: 'rgba(16,185,129,0.26)',
          panel: '#071410',
          chip: 'rgba(16,185,129,0.14)',
          value: '#34d399',
        }
      : {
          primary: SELL_RED,
          secondary: '#dc2626',
          glow: 'rgba(239,68,68,0.24)',
          panel: '#18090b',
          chip: 'rgba(239,68,68,0.14)',
          value: '#f87171',
        }
    const question = alert.marketQuestion
    const pnlText = formatSignedUsd(alert.pnl)
    const resultLabel = alert.won ? 'Won' : 'Lost'
    const outcomeSummary = `${truncateText(alert.outcome, 18)} ${alert.won ? 'WIN' : 'LOSS'}`
    const traderLabel = truncateText(alert.traderName, 26)
    const originalLabel = truncateText(alert.originalAlertLabel || 'Signal', 22)

    const background = ctx.createLinearGradient(0, 0, 1280, 720)
    background.addColorStop(0, '#040805')
    background.addColorStop(0.5, '#07120e')
    background.addColorStop(1, '#030605')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 1280, 720)

    const aura = ctx.createRadialGradient(960, 160, 80, 960, 160, 540)
    aura.addColorStop(0, palette.glow)
    aura.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = aura
    ctx.fillRect(0, 0, 1280, 720)

    const sideAura = ctx.createRadialGradient(180, 620, 40, 180, 620, 420)
    sideAura.addColorStop(0, 'rgba(20,184,166,0.12)')
    sideAura.addColorStop(1, 'rgba(20,184,166,0)')
    ctx.fillStyle = sideAura
    ctx.fillRect(0, 0, 1280, 720)

    fillRoundedRect(ctx, 28, 28, 1224, 664, 36, 'rgba(255,255,255,0.04)')
    fillRoundedRect(ctx, 44, 44, 1192, 632, 30, palette.panel)

    const panelGradient = ctx.createLinearGradient(44, 44, 1236, 676)
    panelGradient.addColorStop(0, 'rgba(255,255,255,0.03)')
    panelGradient.addColorStop(0.55, 'rgba(255,255,255,0.015)')
    panelGradient.addColorStop(1, 'rgba(255,255,255,0.01)')
    fillRoundedRect(ctx, 44, 44, 1192, 632, 30, panelGradient)

    ctx.fillStyle = EMERALD
    ctx.fillRect(44, 74, 4, 572)

    fillRoundedRect(ctx, 74, 76, 236, 44, 22, palette.chip)
    ctx.font = '800 22px Inter, Arial, sans-serif'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText('SIGNAL RESULT', 96, 105)

    fillRoundedRect(ctx, 934, 78, 230, 42, 21, 'rgba(255,255,255,0.06)')
    ctx.font = '700 20px Inter, Arial, sans-serif'
    ctx.fillStyle = '#dbe7e2'
    ctx.textAlign = 'center'
    ctx.fillText(outcomeSummary, 1049, 106)
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
    ctx.fillStyle = 'rgba(226,241,236,0.82)'
    ctx.fillText(`${resultLabel} on ${alert.outcome}`, 82, y)

    y += 16
    const pnlFontSize = fitFontSize(ctx, pnlText, 700, 88, 64, 800)
    ctx.font = `800 ${pnlFontSize}px Inter, Arial, sans-serif`
    ctx.fillStyle = palette.value
    y += pnlFontSize
    ctx.fillText(pnlText, 74, y)

    y += 40
    const panelHeight = 130
    const panelY = Math.max(y, 500)

    fillRoundedRect(
      ctx,
      76,
      panelY,
      1128,
      panelHeight,
      28,
      'rgba(255,255,255,0.04)'
    )
    ctx.fillStyle = EMERALD
    ctx.fillRect(76, panelY, 8, panelHeight)

    const statLabels = [
      { label: 'Trader', value: traderLabel },
      { label: 'Original', value: originalLabel },
      { label: 'Shares', value: formatShares(alert.shares) },
      { label: 'Called', value: formatCalledAgo(alert.daysAgo) },
    ]

    const statColumns = [112, 398, 684, 936]
    ctx.font = '700 16px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,178,167,0.9)'
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
    ctx.fillStyle = 'rgba(226,241,236,0.84)'
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
    const displayMarkets = markets.slice(0, 5)
    const maxVolume = Math.max(
      1,
      ...displayMarkets.map((market) => Number(market.totalVolume || 0))
    )
    const medals = ['🥇', '🥈', '🥉', '4', '5']
    const cardX = 28
    const cardY = 28
    const cardWidth = 1224
    const cardHeight = 664
    const contentX = 92
    const contentRight = 1188
    const rowX = 76
    const rowWidth = 1128
    const marketX = 176
    const marketMaxWidth = 520
    const tradeColumnX = 872
    const volumeColumnX = 1008
    const whaleColumnX = 1140
    const rowGap = 14
    const rowStyles = [
      {
        height: 100,
        accent: AMBER,
        edgeGlow: 'rgba(245,158,11,0.18)',
        backgroundStart: 'rgba(245,158,11,0.11)',
        backgroundEnd: 'rgba(9,26,20,0.92)',
        stroke: 'rgba(251,191,36,0.16)',
        titleColor: '#f8fafc',
        titleSize: 32,
        rankColor: '#fbbf24',
        volumeColor: '#fbbf24',
        barStart: '#f59e0b',
        barEnd: '#fbbf24',
      },
      {
        height: 82,
        accent: TEAL,
        edgeGlow: 'rgba(20,184,166,0.16)',
        backgroundStart: 'rgba(20,184,166,0.08)',
        backgroundEnd: 'rgba(9,26,20,0.9)',
        stroke: 'rgba(94,234,212,0.12)',
        titleColor: '#f8fafc',
        titleSize: 28,
        rankColor: '#99f6e4',
        volumeColor: '#f8fafc',
        barStart: EMERALD,
        barEnd: TEAL,
      },
      {
        height: 82,
        accent: '#0d9488',
        edgeGlow: 'rgba(13,148,136,0.16)',
        backgroundStart: 'rgba(13,148,136,0.08)',
        backgroundEnd: 'rgba(9,26,20,0.9)',
        stroke: 'rgba(45,212,191,0.12)',
        titleColor: '#f8fafc',
        titleSize: 28,
        rankColor: '#5eead4',
        volumeColor: '#f8fafc',
        barStart: '#0d9488',
        barEnd: TEAL,
      },
      {
        height: 82,
        accent: '#2dd4bf',
        edgeGlow: 'rgba(45,212,191,0.12)',
        backgroundStart: 'rgba(255,255,255,0.03)',
        backgroundEnd: 'rgba(9,26,20,0.88)',
        stroke: 'rgba(94,234,212,0.1)',
        titleColor: 'rgba(248,250,252,0.88)',
        titleSize: 27,
        rankColor: 'rgba(153,246,228,0.88)',
        volumeColor: '#e6f8f3',
        barStart: EMERALD,
        barEnd: TEAL,
      },
      {
        height: 82,
        accent: '#5eead4',
        edgeGlow: 'rgba(94,234,212,0.12)',
        backgroundStart: 'rgba(255,255,255,0.03)',
        backgroundEnd: 'rgba(9,26,20,0.88)',
        stroke: 'rgba(153,246,228,0.1)',
        titleColor: 'rgba(248,250,252,0.88)',
        titleSize: 27,
        rankColor: 'rgba(204,251,241,0.88)',
        volumeColor: '#e6f8f3',
        barStart: EMERALD,
        barEnd: TEAL,
      },
    ] as const

    const background = ctx.createLinearGradient(0, 0, 1280, 720)
    background.addColorStop(0, '#050a08')
    background.addColorStop(0.52, '#08150f')
    background.addColorStop(1, '#0a1812')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 1280, 720)

    const emeraldGlow = ctx.createRadialGradient(1090, 96, 10, 1090, 96, 420)
    emeraldGlow.addColorStop(0, 'rgba(16,185,129,0.22)')
    emeraldGlow.addColorStop(0.45, 'rgba(20,184,166,0.08)')
    emeraldGlow.addColorStop(1, 'rgba(16,185,129,0)')
    ctx.fillStyle = emeraldGlow
    ctx.fillRect(0, 0, 1280, 720)

    const goldGlow = ctx.createRadialGradient(260, 248, 0, 260, 248, 260)
    goldGlow.addColorStop(0, 'rgba(245,158,11,0.12)')
    goldGlow.addColorStop(1, 'rgba(245,158,11,0)')
    ctx.fillStyle = goldGlow
    ctx.fillRect(0, 0, 1280, 720)

    ctx.save()
    ctx.strokeStyle = 'rgba(16,185,129,0.05)'
    ctx.lineWidth = 1
    for (let x = 0; x <= 1280; x += 96) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, 720)
      ctx.stroke()
    }
    for (let y = 0; y <= 720; y += 96) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(1280, y)
      ctx.stroke()
    }
    ctx.restore()

    const panelFill = ctx.createLinearGradient(
      cardX,
      cardY,
      cardX + cardWidth,
      cardY + cardHeight
    )
    panelFill.addColorStop(0, 'rgba(8,19,15,0.98)')
    panelFill.addColorStop(0.38, 'rgba(9,26,20,0.96)')
    panelFill.addColorStop(1, 'rgba(7,17,13,0.98)')
    fillRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 34, panelFill)

    ctx.save()
    roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 34)
    ctx.clip()

    const panelSheen = ctx.createLinearGradient(
      cardX,
      cardY,
      cardX + 420,
      cardY + 220
    )
    panelSheen.addColorStop(0, 'rgba(20,184,166,0.08)')
    panelSheen.addColorStop(1, 'rgba(20,184,166,0)')
    ctx.fillStyle = panelSheen
    ctx.fillRect(cardX, cardY, 560, 260)

    const panelVignette = ctx.createLinearGradient(
      0,
      cardY,
      0,
      cardY + cardHeight
    )
    panelVignette.addColorStop(0, 'rgba(255,255,255,0.02)')
    panelVignette.addColorStop(0.55, 'rgba(255,255,255,0)')
    panelVignette.addColorStop(1, 'rgba(2,10,7,0.24)')
    ctx.fillStyle = panelVignette
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight)
    ctx.fillStyle = EMERALD
    ctx.fillRect(cardX, cardY + 36, 4, cardHeight - 72)
    ctx.restore()

    ctx.save()
    ctx.shadowColor = 'rgba(16,185,129,0.12)'
    ctx.shadowBlur = 24
    roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 34)
    ctx.strokeStyle = 'rgba(16,185,129,0.12)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()

    roundedRect(ctx, cardX + 1, cardY + 1, cardWidth - 2, cardHeight - 2, 33)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.font = '800 28px Inter, Arial, sans-serif'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText('SIGNAL HEATMAP', contentX, 100)

    ctx.font = '600 16px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,178,167,0.82)'
    ctx.fillText('Last 12h', contentX, 126)

    ctx.textAlign = 'right'
    ctx.font = '800 18px Inter, Arial, sans-serif'
    ctx.fillStyle = '#99f6e4'
    ctx.fillText('TOP 5', contentRight, 98)
    ctx.font = '600 14px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,178,167,0.68)'
    ctx.fillText('by 12h volume', contentRight, 122)
    ctx.textAlign = 'left'

    const titleRule = ctx.createLinearGradient(contentX, 0, contentRight, 0)
    titleRule.addColorStop(0, 'rgba(16,185,129,0.36)')
    titleRule.addColorStop(0.5, 'rgba(20,184,166,0.12)')
    titleRule.addColorStop(1, 'rgba(16,185,129,0)')
    ctx.fillStyle = titleRule
    ctx.fillRect(contentX, 142, contentRight - contentX, 1)

    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '2px'
    }
    ctx.font = '700 14px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,178,167,0.76)'
    ctx.fillText('MARKET', 104, 173)
    ctx.textAlign = 'center'
    ctx.fillText('TRADES', tradeColumnX, 173)
    ctx.fillText('VOLUME', volumeColumnX, 173)
    ctx.fillText('WALLETS', whaleColumnX, 173)
    ctx.textAlign = 'left'
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '0px'
    }

    const fallbackRowStyle = rowStyles[rowStyles.length - 1]!
    let currentY = 192
    displayMarkets.forEach((market, index) => {
      const rowStyle = rowStyles[index] ?? fallbackRowStyle
      const rowHeight = rowStyle.height
      const rowGradient = ctx.createLinearGradient(
        rowX,
        currentY,
        rowX + rowWidth,
        currentY + rowHeight
      )
      rowGradient.addColorStop(0, rowStyle.backgroundStart)
      rowGradient.addColorStop(1, rowStyle.backgroundEnd)
      fillRoundedRect(ctx, rowX, currentY, rowWidth, rowHeight, 26, rowGradient)

      ctx.save()
      roundedRect(ctx, rowX, currentY, rowWidth, rowHeight, 26)
      ctx.clip()
      ctx.fillStyle = rowStyle.edgeGlow
      ctx.fillRect(rowX, currentY, 18, rowHeight)
      ctx.fillStyle = rowStyle.accent
      ctx.fillRect(rowX, currentY, 4, rowHeight)
      ctx.restore()

      roundedRect(ctx, rowX, currentY, rowWidth, rowHeight, 26)
      ctx.strokeStyle = rowStyle.stroke
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillStyle = rowStyle.rankColor
      ctx.font =
        index < 3
          ? '800 30px Inter, Arial, sans-serif'
          : '800 28px Inter, Arial, sans-serif'
      ctx.fillText(
        medals[index] ?? String(index + 1),
        rowX + 42,
        currentY + rowHeight / 2
      )
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'

      const marketTitle = truncateText(
        market.marketQuestion || market.conditionId,
        38
      )
      const titleSize = fitFontSize(
        ctx,
        marketTitle,
        marketMaxWidth,
        rowStyle.titleSize,
        22,
        700
      )
      ctx.font = `700 ${titleSize}px Inter, Arial, sans-serif`
      ctx.fillStyle = rowStyle.titleColor
      const titleY = currentY + (index === 0 ? 46 : 39)
      ctx.fillText(marketTitle, marketX, titleY)

      if (index < 3) {
        const trackX = marketX
        const trackY = currentY + rowHeight - 24
        const trackWidth = 438
        const trackHeight = 6
        fillRoundedRect(
          ctx,
          trackX,
          trackY,
          trackWidth,
          trackHeight,
          3,
          'rgba(255,255,255,0.06)'
        )
        const rawFillWidth = Math.round(
          (Number(market.totalVolume || 0) / maxVolume) * trackWidth
        )
        if (rawFillWidth > 0) {
          const fillWidth = Math.max(30, rawFillWidth)
          const barGradient = ctx.createLinearGradient(
            trackX,
            trackY,
            trackX + trackWidth,
            trackY
          )
          barGradient.addColorStop(0, rowStyle.barStart)
          barGradient.addColorStop(1, rowStyle.barEnd)
          fillRoundedRect(
            ctx,
            trackX,
            trackY,
            Math.min(trackWidth, fillWidth),
            trackHeight,
            3,
            barGradient
          )
        }
      }

      const statY = currentY + rowHeight / 2 + 10
      const tradeText = String(market.tradeCount)
      const tradeSize = fitFontSize(
        ctx,
        tradeText,
        72,
        index === 0 ? 28 : 26,
        20,
        800
      )
      ctx.font = `800 ${tradeSize}px Inter, Arial, sans-serif`
      ctx.fillStyle = '#f8fafc'
      ctx.textAlign = 'center'
      ctx.fillText(tradeText, tradeColumnX, statY)

      const volumeText = formatCompactUsd(Number(market.totalVolume || 0))
      const volumeSize = fitFontSize(
        ctx,
        volumeText,
        126,
        index === 0 ? 28 : 26,
        18,
        800
      )
      ctx.font = `800 ${volumeSize}px Inter, Arial, sans-serif`
      ctx.fillStyle = rowStyle.volumeColor
      ctx.fillText(volumeText, volumeColumnX, statY)

      const whaleChipWidth = 58
      const whaleChipHeight = 36
      const whaleChipX = whaleColumnX - whaleChipWidth / 2
      const whaleChipY = currentY + rowHeight / 2 - whaleChipHeight / 2 + 3
      fillRoundedRect(
        ctx,
        whaleChipX,
        whaleChipY,
        whaleChipWidth,
        whaleChipHeight,
        18,
        'rgba(16,185,129,0.12)'
      )
      roundedRect(
        ctx,
        whaleChipX,
        whaleChipY,
        whaleChipWidth,
        whaleChipHeight,
        18
      )
      ctx.strokeStyle = 'rgba(52,211,153,0.18)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.font = '800 22px Inter, Arial, sans-serif'
      ctx.fillStyle = '#34d399'
      ctx.fillText(String(market.uniqueWallets), whaleColumnX, statY - 1)
      ctx.textAlign = 'left'

      if (index < displayMarkets.length - 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'
        ctx.fillRect(
          rowX + 18,
          currentY + rowHeight + rowGap / 2,
          rowWidth - 36,
          1
        )
      }

      currentY += rowHeight + rowGap
    })

    if (displayMarkets.length === 0) {
      fillRoundedRect(
        ctx,
        rowX,
        212,
        rowWidth,
        188,
        28,
        'rgba(255,255,255,0.028)'
      )
      roundedRect(ctx, rowX, 212, rowWidth, 188, 28)
      ctx.strokeStyle = 'rgba(16,185,129,0.12)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.font = '800 30px Inter, Arial, sans-serif'
      ctx.fillStyle = '#f8fafc'
      ctx.textAlign = 'center'
      ctx.fillText('No signal activity captured in the last 12h', 640, 302)
      ctx.font = '600 18px Inter, Arial, sans-serif'
      ctx.fillStyle = 'rgba(148,178,167,0.84)'
      ctx.fillText(
        'Heatmap rows populate automatically once market flow appears.',
        640,
        336
      )
      ctx.textAlign = 'left'
    }

    const footerRule = ctx.createLinearGradient(contentX, 0, contentRight, 0)
    footerRule.addColorStop(0, 'rgba(16,185,129,0.28)')
    footerRule.addColorStop(0.5, 'rgba(20,184,166,0.08)')
    footerRule.addColorStop(1, 'rgba(16,185,129,0)')
    ctx.fillStyle = footerRule
    ctx.fillRect(contentX, 624, contentRight - contentX, 1)

    ctx.font = '600 16px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(226,241,236,0.78)'
    ctx.fillText(`Updated ${timestamp} UTC`, contentX, 650)
    ctx.textAlign = 'right'
    ctx.fillText('Ranked by 12h volume', contentRight, 650)
    ctx.textAlign = 'left'

    this.applyGrain(ctx, 1280, 720, 6)

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

  private drawSignalWatermark(ctx: any, centerX: number, centerY: number) {
    ctx.save()
    ctx.strokeStyle = 'rgba(20,184,166,0.16)'
    ctx.lineWidth = 2
    for (const radius of [10, 18, 26]) {
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, Math.PI * 1.15, Math.PI * 1.85)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(16,185,129,0.20)'
    ctx.beginPath()
    ctx.arc(centerX, centerY + 1, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawTraderIdentityChip(
    ctx: any,
    options: {
      x: number
      y: number
      width: number
      height: number
      name: string
      profileImage: any | null
    }
  ) {
    const panel = ctx.createLinearGradient(
      options.x,
      options.y,
      options.x + options.width,
      options.y + options.height
    )
    panel.addColorStop(0, 'rgba(255,255,255,0.045)')
    panel.addColorStop(1, 'rgba(255,255,255,0.018)')
    fillRoundedRect(ctx, options.x, options.y, options.width, options.height, 28, panel)
    strokeRoundedRect(
      ctx,
      options.x + 0.5,
      options.y + 0.5,
      options.width - 1,
      options.height - 1,
      27.5,
      'rgba(20,184,166,0.24)',
      1
    )

    let textX = options.x + 18
    if (options.profileImage) {
      const avatarSize = 52
      const avatarX = options.x + 2
      const avatarY = options.y + 2
      ctx.save()
      ctx.beginPath()
      ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(options.profileImage, avatarX, avatarY, avatarSize, avatarSize)
      ctx.restore()
      ctx.beginPath()
      ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 - 1, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(16,185,129,0.9)'
      ctx.lineWidth = 2
      ctx.stroke()
      textX = avatarX + avatarSize + 14
    }

    ctx.font = '700 13px Inter, Arial, sans-serif'
    ctx.fillStyle = 'rgba(148,178,167,0.74)'
    ctx.fillText('TRADER', textX, options.y + 19)
    ctx.font = `700 ${fitFontSize(ctx, options.name, options.width - (textX - options.x) - 16, 24, 16, 700)}px Inter, Arial, sans-serif`
    ctx.fillStyle = '#f3faf7'
    ctx.fillText(options.name, textX, options.y + 41)
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
