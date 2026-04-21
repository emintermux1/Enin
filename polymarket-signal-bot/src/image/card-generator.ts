import fs from 'node:fs'
import path from 'node:path'
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

type MetricPanelOptions = {
  x: number
  y: number
  width: number
  height: number
  label: string
  value: string
  accent: string
  valueColor?: string
  secondary?: string
  valueSize?: number
}

const LABEL_COLORS: Record<TraderType, string> = {
  WHALE: '#06b6d4',
  INSIDER: '#f59e0b',
  SMART_MONEY: '#10b981',
  TOP_HOLDER: '#8b5cf6',
  CONVICTION_BUILD: '#ec4899',
}

function roundedRect(
  ctx: any,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + safeRadius, y)
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius)
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius)
  ctx.arcTo(x, y + height, x, y, safeRadius)
  ctx.arcTo(x, y, x + width, y, safeRadius)
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
  fontWeight = 700
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

function drawPill(
  ctx: any,
  x: number,
  y: number,
  text: string,
  options: {
    background: any
    color: string
    border?: any
    height?: number
    fontSize?: number
    fontWeight?: number
    paddingX?: number
  }
): number {
  const height = options.height ?? 38
  const fontSize = options.fontSize ?? 16
  const fontWeight = options.fontWeight ?? 700
  const paddingX = options.paddingX ?? 16

  ctx.font = `${fontWeight} ${fontSize}px Inter, Arial, sans-serif`
  const width = Math.ceil(ctx.measureText(text).width) + paddingX * 2

  fillRoundedRect(ctx, x, y, width, height, Math.min(18, height / 2), options.background)
  if (options.border) {
    strokeRoundedRect(
      ctx,
      x + 0.5,
      y + 0.5,
      width - 1,
      height - 1,
      Math.min(17, height / 2),
      options.border,
      1
    )
  }

  ctx.save()
  ctx.fillStyle = options.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + paddingX, y + height / 2 + 1)
  ctx.restore()

  return width
}

function joinNonEmpty(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' · ')
}

export class CardGenerator {
  private modulePromise: Promise<CanvasModule | null> | null = null
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
    const cardX = 32
    const cardY = 32
    const cardWidth = 1216
    const cardHeight = 656
    const radius = 24
    const contentX = 88
    const contentRight = 1160
    const label = getTradeTypeLabel(
      trade.primaryType,
      trade.trade.side,
      trade.isFreshWallet,
      trade.risk.level
    )
    const question = trade.marketInfo.question || trade.trade.title
    const displayName = truncateText(
      trade.trade.name || trade.trade.pseudonym || trade.trade.proxyWallet.slice(0, 10),
      24
    )
    const outcome = trade.trade.outcome || String(trade.trade.outcomeIndex)
    const actionLabel = trade.trade.side === 'BUY' ? 'BUY' : 'SELL'
    const actionColor = trade.trade.side === 'BUY' ? '#10b981' : '#ef4444'
    const actionTextColor = trade.trade.side === 'BUY' ? '#02110b' : '#ffffff'
    const riskColor =
      trade.risk.level === 'HIGH'
        ? '#ef4444'
        : trade.risk.level === 'MED'
          ? '#f59e0b'
          : '#10b981'
    const currentPrice = trade.marketInfo.outcomePrices?.[trade.trade.outcomeIndex]
    const priceValue =
      currentPrice !== undefined &&
      currentPrice > 0 &&
      Math.abs(currentPrice - trade.trade.price) >= 0.01
        ? `${formatPriceCents(trade.trade.price)} → ${formatPriceCents(currentPrice)}`
        : formatPriceCents(trade.trade.price)
    const momentumValue =
      trade.priceMomentum &&
      Math.abs(trade.priceMomentum.changePercent) >= 10 &&
      trade.priceMomentum.direction !== 'flat'
        ? `${trade.priceMomentum.direction === 'up' ? '↑' : '↓'}${Math.abs(
            trade.priceMomentum.changePercent
          )}% ${trade.priceMomentum.periodLabel}`
        : null
    const topSideSummary =
      trade.holderStats.topHoldersOnSide > 0
        ? `${trade.holderStats.topHoldersOnSide}/20 top holders ${truncateText(
            trade.holderStats.side,
            18
          )}`
        : null

    this.drawBackdrop(ctx, 1280, 720, '#10b981', '#06b6d4')
    this.drawShell(ctx, cardX, cardY, cardWidth, cardHeight, radius, '#10b981', '#06b6d4')

    const labelWidth = drawPill(ctx, contentX, 72, label, {
      background: hexToRgba(LABEL_COLORS[trade.primaryType], 0.16),
      color: LABEL_COLORS[trade.primaryType],
      border: hexToRgba(LABEL_COLORS[trade.primaryType], 0.4),
      fontSize: 17,
      height: 40,
      paddingX: 18,
    })

    let chipX = contentX + labelWidth + 12
    if (trade.isFreshWallet) {
      chipX +=
        drawPill(ctx, chipX, 74, 'FRESH WALLET', {
          background: 'rgba(255,255,255,0.04)',
          color: '#e4e4e7',
          border: 'rgba(255,255,255,0.08)',
          fontSize: 14,
          height: 36,
          paddingX: 14,
        }) + 10
    }
    if (trade.smartScore && trade.smartScore > 0) {
      drawPill(ctx, chipX, 74, `SMART ${trade.smartScore}`, {
        background: 'rgba(6,182,212,0.12)',
        color: '#67e8f9',
        border: 'rgba(6,182,212,0.26)',
        fontSize: 14,
        height: 36,
        paddingX: 14,
      })
    }

    const riskText = `RISK ${trade.risk.level}`
    ctx.font = '700 16px Inter, Arial, sans-serif'
    const riskWidth = Math.ceil(ctx.measureText(riskText).width) + 32
    drawPill(ctx, contentRight - riskWidth, 72, riskText, {
      background: hexToRgba(riskColor, 0.14),
      color: riskColor,
      border: hexToRgba(riskColor, 0.34),
      fontSize: 16,
      height: 40,
      paddingX: 16,
    })

    ctx.font = '800 54px Inter, Arial, sans-serif'
    ctx.fillStyle = '#ffffff'
    const titleLines = wrapText(ctx, question, contentRight - contentX, 2)
    let titleY = 164
    titleLines.forEach((line, index) => {
      ctx.fillText(line, contentX, titleY + index * 58)
    })

    const subtitleY = titleY + (titleLines.length - 1) * 58 + 48
    const actionWidth = drawPill(ctx, contentX, subtitleY - 28, actionLabel, {
      background: actionColor,
      color: actionTextColor,
      fontSize: 16,
      height: 36,
      paddingX: 16,
      fontWeight: 800,
    })

    ctx.font = '600 20px Inter, Arial, sans-serif'
    ctx.fillStyle = '#a1a1aa'
    ctx.fillText(
      `${outcome} • Resolves ${formatResolveDate(trade.marketInfo.endDate)}`,
      contentX + actionWidth + 18,
      subtitleY
    )

    const gridTop = subtitleY + 36
    const gridGapX = 28
    const gridGapY = 18
    const panelWidth = (contentRight - contentX - gridGapX) / 2
    const panelHeight = 86
    const leftX = contentX
    const rightX = contentX + panelWidth + gridGapX

    this.drawMetricPanel(ctx, {
      x: leftX,
      y: gridTop,
      width: panelWidth,
      height: panelHeight,
      label: 'Amount',
      value: formatUsd(trade.trade.usdcSize),
      accent: actionColor,
      valueColor: '#ffffff',
      valueSize: 34,
      secondary:
        trade.trade.usdcSize >= 50_000 ? 'High-conviction size' : 'Tracked entry size',
    })
    this.drawMetricPanel(ctx, {
      x: rightX,
      y: gridTop,
      width: panelWidth,
      height: panelHeight,
      label: 'Win Potential',
      value: formatUsd(trade.potentialWin),
      accent: '#10b981',
      valueColor: '#ffffff',
      valueSize: 34,
      secondary: trade.trade.side === 'BUY' ? 'Upside if market resolves' : 'Recovered capital path',
    })

    this.drawMetricPanel(ctx, {
      x: leftX,
      y: gridTop + panelHeight + gridGapY,
      width: panelWidth,
      height: panelHeight,
      label: 'Price',
      value: priceValue,
      accent: '#06b6d4',
      valueColor: '#ffffff',
      valueSize: 30,
      secondary: momentumValue || 'Live pricing stable',
    })
    this.drawMetricPanel(ctx, {
      x: rightX,
      y: gridTop + panelHeight + gridGapY,
      width: panelWidth,
      height: panelHeight,
      label: 'Multiplier',
      value: formatMultiplier(trade.multiplier),
      accent: '#06b6d4',
      valueColor: '#ffffff',
      valueSize: 30,
      secondary:
        trade.traderStats.bestWinStreak && trade.traderStats.bestWinStreak > 1
          ? `Best streak ${trade.traderStats.bestWinStreak}`
          : 'Reward / risk snapshot',
    })

    this.drawMetricPanel(ctx, {
      x: leftX,
      y: gridTop + (panelHeight + gridGapY) * 2,
      width: panelWidth,
      height: panelHeight,
      label: 'Outcome',
      value: `${trade.trade.side} ${truncateText(outcome, 24)}`,
      accent: LABEL_COLORS[trade.primaryType],
      valueColor: '#ffffff',
      valueSize: 28,
      secondary: topSideSummary || 'No concentrated top-holder signal',
    })
    this.drawMetricPanel(ctx, {
      x: rightX,
      y: gridTop + (panelHeight + gridGapY) * 2,
      width: panelWidth,
      height: panelHeight,
      label: 'Trader',
      value: displayName,
      accent: '#f59e0b',
      valueColor: '#ffffff',
      valueSize: 28,
      secondary: joinNonEmpty([
        trade.xUsername ? `𝕏 @${trade.xUsername}` : null,
        `P&L ${formatSignedUsd(trade.traderStats.totalRealizedPnl)}`,
      ]),
    })

    const separatorY = cardY + cardHeight - 110
    const separator = ctx.createLinearGradient(contentX, separatorY, contentRight, separatorY)
    separator.addColorStop(0, 'rgba(16,185,129,0.9)')
    separator.addColorStop(0.5, 'rgba(6,182,212,0.7)')
    separator.addColorStop(1, 'rgba(245,158,11,0.15)')
    ctx.fillStyle = separator
    ctx.fillRect(contentX, separatorY, contentRight - contentX, 1)

    const footerItems = [
      {
        label: 'Resolve',
        value: formatResolveDate(trade.marketInfo.endDate),
      },
      {
        label: 'Market',
        value:
          trade.marketInfo.volume > 0
            ? `${formatCompactUsd(trade.marketInfo.volume)} vol`
            : `${formatCompactUsd(trade.marketInfo.liquidity)} liq`,
      },
      {
        label: 'Tracker',
        value:
          trade.traderStats.closedPositions >= 3
            ? `${Math.round(trade.traderStats.winRate)}% win`
            : `${trade.traderStats.livePositions} live`,
      },
      {
        label: 'Flow',
        value:
          trade.holderStats.whalesInMarket > 0 ||
          trade.holderStats.insidersInMarket > 0 ||
          trade.freshWalletsInMarket > 0
            ? joinNonEmpty([
                trade.holderStats.whalesInMarket > 0
                  ? `${trade.holderStats.whalesInMarket} whales`
                  : null,
                trade.holderStats.insidersInMarket > 0
                  ? `${trade.holderStats.insidersInMarket} insiders`
                  : null,
                trade.freshWalletsInMarket > 0
                  ? `${trade.freshWalletsInMarket} fresh`
                  : null,
              ])
            : 'Single-wallet read',
      },
    ]

    const footerStartX = contentX
    const footerWidth = contentRight - contentX
    const footerColumnWidth = footerWidth / footerItems.length
    footerItems.forEach((item, index) => {
      const itemX = footerStartX + footerColumnWidth * index
      ctx.font = '700 13px Inter, Arial, sans-serif'
      ctx.fillStyle = '#71717a'
      ctx.fillText(item.label.toUpperCase(), itemX, separatorY + 26)
      const valueSize = fitFontSize(ctx, item.value, footerColumnWidth - 20, 22, 15, 700)
      ctx.font = `700 ${valueSize}px Inter, Arial, sans-serif`
      ctx.fillStyle = '#f4f4f5'
      ctx.fillText(item.value, itemX, separatorY + 58)
    })

    this.applyGrain(ctx, 1280, 720, 5)

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
    const primary = alert.won ? '#10b981' : '#ef4444'
    const secondary = alert.won ? '#06b6d4' : '#f59e0b'
    const cardX = 32
    const cardY = 32
    const cardWidth = 1216
    const cardHeight = 656
    const radius = 24
    const contentX = 88
    const contentRight = 1160
    const question = alert.marketQuestion
    const pnlText = formatSignedUsd(alert.pnl)
    const originalLabel = truncateText(alert.originalAlertLabel || 'Signal', 24)
    const outcomeSummary = `${truncateText(alert.outcome, 18)} ${alert.won ? 'WIN' : 'LOSS'}`
    const footerFlow =
      alert.whalesInMarket > 0 || alert.insidersInMarket > 0 || alert.freshWalletsInMarket > 0
        ? joinNonEmpty([
            alert.whalesInMarket > 0 ? `${alert.whalesInMarket} whales` : null,
            alert.insidersInMarket > 0 ? `${alert.insidersInMarket} insiders` : null,
            alert.freshWalletsInMarket > 0 ? `${alert.freshWalletsInMarket} fresh` : null,
          ])
        : 'Standalone signal'

    this.drawBackdrop(ctx, 1280, 720, primary, secondary)
    this.drawShell(ctx, cardX, cardY, cardWidth, cardHeight, radius, primary, secondary)

    drawPill(ctx, contentX, 72, 'RESULT CARD', {
      background: hexToRgba(primary, 0.16),
      color: primary,
      border: hexToRgba(primary, 0.34),
      fontSize: 16,
      height: 38,
      paddingX: 16,
    })

    ctx.font = '700 16px Inter, Arial, sans-serif'
    const outcomeWidth = Math.ceil(ctx.measureText(outcomeSummary).width) + 32
    drawPill(ctx, contentRight - outcomeWidth, 72, outcomeSummary, {
      background: 'rgba(255,255,255,0.04)',
      color: '#f4f4f5',
      border: 'rgba(255,255,255,0.08)',
      fontSize: 15,
      height: 38,
      paddingX: 16,
    })

    ctx.font = '800 50px Inter, Arial, sans-serif'
    ctx.fillStyle = '#ffffff'
    const titleLines = wrapText(ctx, question, contentRight - contentX, 2)
    let titleY = 160
    titleLines.forEach((line, index) => {
      ctx.fillText(line, contentX, titleY + index * 54)
    })

    const pnlY = titleY + (titleLines.length - 1) * 54 + 92
    ctx.font = `800 ${fitFontSize(ctx, pnlText, 520, 86, 58, 800)}px Inter, Arial, sans-serif`
    ctx.fillStyle = primary
    ctx.fillText(pnlText, contentX, pnlY)

    ctx.font = '600 22px Inter, Arial, sans-serif'
    ctx.fillStyle = '#a1a1aa'
    ctx.fillText(
      `${alert.won ? 'Resolved in profit' : 'Resolved in loss'} • ${formatResolveDate(alert.resolvedAt)}`,
      contentX,
      pnlY + 34
    )

    const gridTop = pnlY + 72
    const cols = 3
    const gap = 18
    const panelWidth = (contentRight - contentX - gap * (cols - 1)) / cols
    const rowHeight = 92

    const panels: MetricPanelOptions[] = [
      {
        x: contentX,
        y: gridTop,
        width: panelWidth,
        height: rowHeight,
        label: 'Trader',
        value: truncateText(alert.traderName, 22),
        accent: primary,
        secondary: formatCalledAgo(alert.daysAgo),
        valueSize: 28,
      },
      {
        x: contentX + panelWidth + gap,
        y: gridTop,
        width: panelWidth,
        height: rowHeight,
        label: 'Original Signal',
        value: originalLabel,
        accent: secondary,
        secondary: toTradeResultLabel(alert.primaryType),
        valueSize: 24,
      },
      {
        x: contentX + (panelWidth + gap) * 2,
        y: gridTop,
        width: panelWidth,
        height: rowHeight,
        label: 'Entry',
        value: `${formatUsd(alert.entryAmount)} @ ${formatPriceCents(alert.entryPrice)}`,
        accent: '#06b6d4',
        secondary: 'Recorded alert entry',
        valueSize: 23,
      },
      {
        x: contentX,
        y: gridTop + rowHeight + gap,
        width: panelWidth,
        height: rowHeight,
        label: 'Shares',
        value: formatShares(alert.shares),
        accent: '#06b6d4',
        secondary: `Outcome ${truncateText(alert.outcome, 18)}`,
        valueSize: 30,
      },
      {
        x: contentX + panelWidth + gap,
        y: gridTop + rowHeight + gap,
        width: panelWidth,
        height: rowHeight,
        label: 'Payout',
        value: formatMultiplier(alert.multiplier),
        accent: primary,
        secondary: `Potential ${formatUsd(alert.potentialWin)}`,
        valueSize: 30,
      },
      {
        x: contentX + (panelWidth + gap) * 2,
        y: gridTop + rowHeight + gap,
        width: panelWidth,
        height: rowHeight,
        label: 'Market Read',
        value: footerFlow,
        accent: '#f59e0b',
        secondary: 'Context at resolution',
        valueSize: 21,
      },
    ]

    panels.forEach((panel) => this.drawMetricPanel(ctx, panel))

    const separatorY = cardY + cardHeight - 86
    const separator = ctx.createLinearGradient(contentX, separatorY, contentRight, separatorY)
    separator.addColorStop(0, hexToRgba(primary, 0.95))
    separator.addColorStop(0.5, hexToRgba(secondary, 0.72))
    separator.addColorStop(1, 'rgba(255,255,255,0.08)')
    ctx.fillStyle = separator
    ctx.fillRect(contentX, separatorY, contentRight - contentX, 1)

    const footerText = joinNonEmpty([
      `Resolved ${formatResolveDate(alert.resolvedAt)}`,
      `Entry ${formatUsd(alert.entryAmount)}`,
      `Shares ${formatShares(alert.shares)}`,
      `Payout ${formatMultiplier(alert.multiplier)}`,
    ])

    ctx.font = '600 18px Inter, Arial, sans-serif'
    ctx.fillStyle = '#d4d4d8'
    ctx.fillText(footerText, contentX, separatorY + 34)
    ctx.font = '600 16px Inter, Arial, sans-serif'
    ctx.fillStyle = '#71717a'
    ctx.fillText('Signal archive • structured result feed', contentX, separatorY + 60)

    this.applyGrain(ctx, 1280, 720, 4)

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
    const cardX = 32
    const cardY = 32
    const cardWidth = 1216
    const cardHeight = 656
    const radius = 24
    const contentX = 88
    const contentRight = 1160
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
    const displayMarkets = markets.slice(0, 5)
    const maxVolume = Math.max(1, ...displayMarkets.map((market) => Number(market.totalVolume || 0)))
    const rowAccents = ['#10b981', '#06b6d4', '#f59e0b', '#14b8a6', '#8b5cf6']

    this.drawBackdrop(ctx, 1280, 720, '#10b981', '#06b6d4')
    this.drawShell(ctx, cardX, cardY, cardWidth, cardHeight, radius, '#10b981', '#06b6d4')

    ctx.font = '800 32px Inter, Arial, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('MARKET HEATMAP', contentX, 102)
    ctx.font = '600 17px Inter, Arial, sans-serif'
    ctx.fillStyle = '#a1a1aa'
    ctx.fillText('Signal concentration over the last 12 hours', contentX, 132)

    drawPill(ctx, contentRight - 210, 72, `UPDATED ${timestamp} UTC`, {
      background: 'rgba(6,182,212,0.12)',
      color: '#67e8f9',
      border: 'rgba(6,182,212,0.22)',
      fontSize: 14,
      height: 36,
      paddingX: 14,
    })

    const titleRule = ctx.createLinearGradient(contentX, 146, contentRight, 146)
    titleRule.addColorStop(0, 'rgba(16,185,129,0.82)')
    titleRule.addColorStop(0.5, 'rgba(6,182,212,0.42)')
    titleRule.addColorStop(1, 'rgba(255,255,255,0.04)')
    ctx.fillStyle = titleRule
    ctx.fillRect(contentX, 146, contentRight - contentX, 1)

    const rankX = 118
    const marketX = 188
    const tradesX = 884
    const volumeX = 1008
    const walletsX = 1120

    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '1.4px'
    }
    ctx.font = '700 13px Inter, Arial, sans-serif'
    ctx.fillStyle = '#71717a'
    ctx.fillText('RANK', rankX, 174)
    ctx.fillText('MARKET', marketX, 174)
    ctx.textAlign = 'center'
    ctx.fillText('TRADES', tradesX, 174)
    ctx.fillText('VOLUME', volumeX, 174)
    ctx.fillText('WALLETS', walletsX, 174)
    ctx.textAlign = 'left'
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '0px'
    }

    let currentY = 194
    const rowHeight = 84
    const rowGap = 16

    displayMarkets.forEach((market, index) => {
      const accent = rowAccents[index] ?? '#10b981'
      const rowGradient = ctx.createLinearGradient(76, currentY, 1204, currentY + rowHeight)
      rowGradient.addColorStop(0, 'rgba(255,255,255,0.038)')
      rowGradient.addColorStop(1, 'rgba(255,255,255,0.016)')
      fillRoundedRect(ctx, 76, currentY, 1128, rowHeight, 20, rowGradient)
      strokeRoundedRect(ctx, 76.5, currentY + 0.5, 1127, rowHeight - 1, 19.5, 'rgba(255,255,255,0.08)', 1)

      ctx.save()
      roundedRect(ctx, 76, currentY, 1128, rowHeight, 20)
      ctx.clip()
      ctx.fillStyle = hexToRgba(accent, 0.95)
      ctx.fillRect(76, currentY, 4, rowHeight)
      ctx.fillStyle = hexToRgba(accent, 0.12)
      ctx.fillRect(80, currentY, 16, rowHeight)
      ctx.restore()

      drawPill(ctx, 104, currentY + 22, String(index + 1).padStart(2, '0'), {
        background: hexToRgba(accent, 0.14),
        color: accent,
        border: hexToRgba(accent, 0.28),
        fontSize: 15,
        height: 36,
        paddingX: 14,
      })

      const marketTitle = truncateText(market.marketQuestion || market.conditionId, 42)
      const titleSize = fitFontSize(ctx, marketTitle, 610, 28, 21, 700)
      ctx.font = `700 ${titleSize}px Inter, Arial, sans-serif`
      ctx.fillStyle = '#ffffff'
      ctx.fillText(marketTitle, marketX, currentY + 34)

      const trackX = marketX
      const trackY = currentY + 56
      const trackWidth = 420
      fillRoundedRect(ctx, trackX, trackY, trackWidth, 6, 3, 'rgba(255,255,255,0.06)')
      const fillWidth = Math.max(
        24,
        Math.min(trackWidth, Math.round((Number(market.totalVolume || 0) / maxVolume) * trackWidth))
      )
      const barGradient = ctx.createLinearGradient(trackX, trackY, trackX + fillWidth, trackY)
      barGradient.addColorStop(0, hexToRgba(accent, 0.95))
      barGradient.addColorStop(1, hexToRgba('#06b6d4', 0.95))
      fillRoundedRect(ctx, trackX, trackY, fillWidth, 6, 3, barGradient)

      ctx.font = '600 14px Inter, Arial, sans-serif'
      ctx.fillStyle = '#71717a'
      ctx.fillText(`${market.tradeCount} tracked prints`, marketX, currentY + 79)

      ctx.textAlign = 'center'
      ctx.font = '800 26px Inter, Arial, sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(String(market.tradeCount), tradesX, currentY + 54)

      const volumeText = formatCompactUsd(Number(market.totalVolume || 0))
      ctx.font = `800 ${fitFontSize(ctx, volumeText, 120, 24, 18, 800)}px Inter, Arial, sans-serif`
      ctx.fillStyle = index === 0 ? '#fbbf24' : '#e4e4e7'
      ctx.fillText(volumeText, volumeX, currentY + 54)

      drawPill(ctx, walletsX - 28, currentY + 24, String(market.uniqueWallets), {
        background: 'rgba(16,185,129,0.12)',
        color: '#34d399',
        border: 'rgba(16,185,129,0.24)',
        fontSize: 18,
        height: 34,
        paddingX: 16,
      })
      ctx.textAlign = 'left'

      currentY += rowHeight + rowGap
    })

    if (displayMarkets.length === 0) {
      fillRoundedRect(ctx, 76, 210, 1128, 156, 22, 'rgba(255,255,255,0.03)')
      strokeRoundedRect(ctx, 76.5, 210.5, 1127, 155, 21.5, 'rgba(255,255,255,0.08)', 1)
      ctx.font = '800 30px Inter, Arial, sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.fillText('No signal clusters captured in the last 12h', 640, 286)
      ctx.font = '600 18px Inter, Arial, sans-serif'
      ctx.fillStyle = '#a1a1aa'
      ctx.fillText('Rows will populate automatically once the market feed is active.', 640, 320)
      ctx.textAlign = 'left'
    }

    const footerY = cardY + cardHeight - 54
    const footerRule = ctx.createLinearGradient(contentX, footerY - 20, contentRight, footerY - 20)
    footerRule.addColorStop(0, 'rgba(16,185,129,0.78)')
    footerRule.addColorStop(0.5, 'rgba(6,182,212,0.4)')
    footerRule.addColorStop(1, 'rgba(255,255,255,0.04)')
    ctx.fillStyle = footerRule
    ctx.fillRect(contentX, footerY - 20, contentRight - contentX, 1)

    ctx.font = '600 16px Inter, Arial, sans-serif'
    ctx.fillStyle = '#d4d4d8'
    ctx.fillText(`Updated ${timestamp} UTC`, contentX, footerY)
    ctx.textAlign = 'right'
    ctx.fillText('Ranked by 12h volume across tracked markets', contentRight, footerY)
    ctx.textAlign = 'left'

    this.applyGrain(ctx, 1280, 720, 4)

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

  private drawBackdrop(
    ctx: any,
    width: number,
    height: number,
    primary: string,
    secondary: string
  ) {
    const background = ctx.createLinearGradient(0, 0, width, height)
    background.addColorStop(0, '#0a0a0a')
    background.addColorStop(0.55, '#0f0f10')
    background.addColorStop(1, '#111111')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)

    const leftGlow = ctx.createRadialGradient(180, 120, 20, 180, 120, 360)
    leftGlow.addColorStop(0, hexToRgba(primary, 0.18))
    leftGlow.addColorStop(0.5, hexToRgba(primary, 0.05))
    leftGlow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = leftGlow
    ctx.fillRect(0, 0, width, height)

    const rightGlow = ctx.createRadialGradient(width - 220, height - 120, 30, width - 220, height - 120, 340)
    rightGlow.addColorStop(0, hexToRgba(secondary, 0.16))
    rightGlow.addColorStop(0.5, hexToRgba(secondary, 0.05))
    rightGlow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rightGlow
    ctx.fillRect(0, 0, width, height)

    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.lineWidth = 1
    for (let x = 0; x <= width; x += 64) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = 0; y <= height; y += 64) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = 'rgba(16,185,129,0.05)'
    ctx.lineWidth = 1
    for (let x = -height; x < width; x += 180) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + 220, 220)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawShell(
    ctx: any,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    primary: string,
    secondary: string
  ) {
    const panelGradient = ctx.createLinearGradient(x, y, x + width, y + height)
    panelGradient.addColorStop(0, 'rgba(16,16,17,0.98)')
    panelGradient.addColorStop(0.52, 'rgba(12,12,13,0.985)')
    panelGradient.addColorStop(1, 'rgba(17,17,17,0.98)')
    fillRoundedRect(ctx, x, y, width, height, radius, panelGradient)

    ctx.save()
    roundedRect(ctx, x, y, width, height, radius)
    ctx.clip()

    const topSheen = ctx.createLinearGradient(x, y, x + 420, y + 240)
    topSheen.addColorStop(0, 'rgba(255,255,255,0.05)')
    topSheen.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = topSheen
    ctx.fillRect(x, y, 500, 240)

    const lowerTint = ctx.createLinearGradient(x, y + height, x + width, y + height - 180)
    lowerTint.addColorStop(0, 'rgba(16,185,129,0.04)')
    lowerTint.addColorStop(0.45, 'rgba(6,182,212,0.02)')
    lowerTint.addColorStop(1, 'rgba(245,158,11,0.015)')
    ctx.fillStyle = lowerTint
    ctx.fillRect(x, y, width, height)

    ctx.fillStyle = hexToRgba(primary, 0.96)
    ctx.fillRect(x, y, 4, height)
    ctx.fillStyle = hexToRgba(primary, 0.12)
    ctx.fillRect(x + 4, y, 16, height)
    ctx.restore()

    const borderGradient = ctx.createLinearGradient(x, y, x + width, y)
    borderGradient.addColorStop(0, hexToRgba(primary, 0.85))
    borderGradient.addColorStop(0.45, hexToRgba(secondary, 0.55))
    borderGradient.addColorStop(1, 'rgba(255,255,255,0.08)')

    ctx.save()
    ctx.shadowColor = hexToRgba(primary, 0.2)
    ctx.shadowBlur = 28
    strokeRoundedRect(ctx, x + 0.5, y + 0.5, width - 1, height - 1, radius - 0.5, borderGradient, 1.2)
    ctx.restore()

    strokeRoundedRect(ctx, x + 1.5, y + 1.5, width - 3, height - 3, radius - 1.5, 'rgba(255,255,255,0.06)', 1)
  }

  private drawMetricPanel(ctx: any, options: MetricPanelOptions) {
    const panelGradient = ctx.createLinearGradient(
      options.x,
      options.y,
      options.x + options.width,
      options.y + options.height
    )
    panelGradient.addColorStop(0, 'rgba(255,255,255,0.04)')
    panelGradient.addColorStop(1, 'rgba(255,255,255,0.018)')
    fillRoundedRect(
      ctx,
      options.x,
      options.y,
      options.width,
      options.height,
      18,
      panelGradient
    )
    strokeRoundedRect(
      ctx,
      options.x + 0.5,
      options.y + 0.5,
      options.width - 1,
      options.height - 1,
      17.5,
      'rgba(255,255,255,0.08)',
      1
    )

    ctx.save()
    roundedRect(ctx, options.x, options.y, options.width, options.height, 18)
    ctx.clip()
    ctx.fillStyle = hexToRgba(options.accent, 0.95)
    ctx.fillRect(options.x, options.y, 3, options.height)
    ctx.fillStyle = hexToRgba(options.accent, 0.09)
    ctx.fillRect(options.x + 3, options.y, 14, options.height)
    ctx.restore()

    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '1.2px'
    }
    ctx.font = '700 12px Inter, Arial, sans-serif'
    ctx.fillStyle = '#71717a'
    ctx.fillText(options.label.toUpperCase(), options.x + 24, options.y + 22)
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '0px'
    }

    const value = truncateText(options.value, 34)
    const valueSize = fitFontSize(
      ctx,
      value,
      options.width - 42,
      options.valueSize ?? 30,
      18,
      700
    )
    ctx.font = `700 ${valueSize}px Inter, Arial, sans-serif`
    ctx.fillStyle = options.valueColor ?? '#ffffff'
    ctx.fillText(value, options.x + 24, options.y + 54)

    if (options.secondary) {
      const secondarySize = fitFontSize(ctx, options.secondary, options.width - 42, 15, 11, 600)
      ctx.font = `600 ${secondarySize}px Inter, Arial, sans-serif`
      ctx.fillStyle = '#a1a1aa'
      ctx.fillText(truncateText(options.secondary, 48), options.x + 24, options.y + 76)
    }
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

function toTradeResultLabel(primaryType: TraderType): string {
  return getTradeTypeLabel(primaryType, 'BUY')
}
