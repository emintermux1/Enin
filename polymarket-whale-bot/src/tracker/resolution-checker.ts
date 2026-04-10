import { getTradeTypeLabel } from '../classifier/trader-classifier'
import { GammaApi, GammaMarketLookup } from '../api/gamma-api'
import { TraderPerformanceRepo } from '../db/trader-performance-repo'
import { WalletTradeRepo } from '../db/wallet-trade-repo'
import { ChannelPoster } from '../telegram/channel-poster'
import { TraderType } from '../types'
import { logger } from '../utils/logger'

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function parseOutcomes(value: string[] | string | undefined): string[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value
  }
  try {
    const parsed = JSON.parse(value) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseOutcomePrices(value: number[] | string[] | string | undefined): number[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
  }
  try {
    const parsed = JSON.parse(value) as Array<number | string>
    return Array.isArray(parsed)
      ? parsed.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
      : []
  } catch {
    return []
  }
}

function toTraderType(value: string): TraderType {
  if (value === 'INSIDER' || value === 'SMART_MONEY' || value === 'TOP_HOLDER' || value === 'CONVICTION_BUILD') {
    return value
  }
  return 'WHALE'
}

export class ResolutionChecker {
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private checking = false
  private readonly checkedMarkets = new Set<string>()
  private readonly MIN_PROFIT = 50_000
  private readonly POLL_INTERVAL_MS = 30 * 60 * 1000

  constructor(
    private readonly gammaApi: GammaApi,
    private readonly walletTradeRepo: WalletTradeRepo,
    private readonly traderPerformanceRepo: TraderPerformanceRepo,
    private readonly poster: ChannelPoster,
  ) {}

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => void this.check(), this.POLL_INTERVAL_MS)
    this.startupTimer = setTimeout(() => void this.check(), 60_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
  }

  private async check(): Promise<void> {
    if (this.checking) {
      return
    }
    this.checking = true

    try {
      const resolvedMarkets = await this.gammaApi.getRecentlyResolvedMarkets(2, 100).catch(() => [])

      for (const market of resolvedMarkets) {
        if (!market.conditionId || this.checkedMarkets.has(market.conditionId)) {
          continue
        }

        const alertedTrades = this.walletTradeRepo.getAlertedTradesForCondition(market.conditionId)
        this.checkedMarkets.add(market.conditionId)
        if (alertedTrades.length === 0) {
          continue
        }

        const outcomes = parseOutcomes(market.outcomes)
        const winningOutcomeIndex = this.getWinningOutcomeIndex(market)
        if (winningOutcomeIndex < 0) {
          continue
        }
        const winningOutcome = outcomes[winningOutcomeIndex] || String(winningOutcomeIndex)
        const resolvedTimestamp = this.getResolvedTimestamp(market)
        const performanceWallets = this.traderPerformanceRepo.resolveTradesForMarket(
          market.conditionId,
          winningOutcome,
          resolvedTimestamp,
        )

        const whalesInMarket = alertedTrades.filter((trade) => trade.primaryType === 'WHALE').length
        const insidersInMarket = alertedTrades.filter((trade) => trade.primaryType === 'INSIDER').length

        for (const trade of alertedTrades) {
          const tradeOutcomeIndex = this.getTradeOutcomeIndex(trade.outcome, outcomes)
          if (tradeOutcomeIndex < 0) {
            continue
          }

          const won = tradeOutcomeIndex === winningOutcomeIndex
          const safePrice = Math.max(trade.price || 0.01, 0.01)
          const multiplier = trade.multiplier > 0 ? trade.multiplier : 1 / safePrice
          const potentialWin = trade.potentialWin > 0 ? trade.potentialWin : trade.amount * multiplier
          const pnl = won ? potentialWin - trade.amount : -trade.amount
          if (pnl < this.MIN_PROFIT) {
            continue
          }

          logger.info(
            `Resolution PnL card: ${market.question || trade.marketQuestion} - ${trade.wallet} made ${pnl >= 0 ? '+' : ''}$${Math.round(pnl)}`
          )

          await this.poster.postResolutionCard({
            marketQuestion: market.question || trade.marketQuestion,
            marketSlug: market.eventSlug || market.slug,
            outcome: winningOutcome || trade.outcome,
            won,
            pnl,
            entryAmount: trade.amount,
            entryPrice: safePrice,
            shares: trade.amount / safePrice,
            traderName: trade.traderName || trade.wallet.slice(0, 10),
            traderWallet: trade.wallet,
            primaryType: toTraderType(trade.primaryType),
            daysAgo: Math.max(0, Math.round((Date.now() / 1000 - trade.timestamp) / 86400)),
            resolvedAt: market.updatedAt || market.closedTime || market.closeTime || market.endDate || new Date().toISOString(),
            originalAlertLabel: getTradeTypeLabel(toTraderType(trade.primaryType), trade.side as 'BUY' | 'SELL'),
            multiplier,
            potentialWin,
            whalesInMarket,
            insidersInMarket,
            freshWalletsInMarket: 0,
          })
        }

        for (const wallet of performanceWallets) {
          await this.postWalletPerformanceUpdates(wallet)
        }
      }

      this.trimCheckedMarkets()
    } catch (error) {
      logger.warn('Resolution check failed', error)
    } finally {
      this.checking = false
    }
  }

  private getWinningOutcomeIndex(market: GammaMarketLookup): number {
    const prices = parseOutcomePrices(market.outcomePrices)
    return prices.findIndex((price) => price >= 0.99)
  }

  private getTradeOutcomeIndex(tradeOutcome: string, outcomes: string[]): number {
    const normalizedTradeOutcome = normalizeText(tradeOutcome)
    const matchedOutcome = outcomes.findIndex(
      (outcome) => normalizeText(outcome) === normalizedTradeOutcome
    )
    if (matchedOutcome >= 0) {
      return matchedOutcome
    }

    const numericIndex = Number.parseInt(tradeOutcome, 10)
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < outcomes.length) {
      return numericIndex
    }

    return -1
  }

  private getResolvedTimestamp(market: GammaMarketLookup): number {
    const resolvedAt = market.updatedAt || market.closedTime || market.closeTime || market.endDate || ''
    const parsed = Date.parse(resolvedAt)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000)
  }

  private async postWalletPerformanceUpdates(wallet: string): Promise<void> {
    const alertCount = this.traderPerformanceRepo.getWalletAlertCount(wallet)
    const backtest = this.traderPerformanceRepo.getBacktest(wallet)

    if (
      backtest &&
      backtest.resolvedTrades >= 5 &&
      this.traderPerformanceRepo.shouldPostBacktest(wallet, alertCount)
    ) {
      await this.poster.postBacktest(backtest)
      this.traderPerformanceRepo.markBacktestPosted(wallet, alertCount)
      logger.info(`Posted trader backtest for ${wallet} after market resolution`)
    }

    if (alertCount >= 10) {
      const performanceAlerts = this.traderPerformanceRepo.getPendingPerformanceAlerts(wallet, backtest)
      for (const performanceAlert of performanceAlerts) {
        await this.poster.postPerformanceAlert(
          wallet,
          this.traderPerformanceRepo.getWalletDisplayName(wallet),
          performanceAlert,
        )
        this.traderPerformanceRepo.markPerformanceAlertPosted(wallet, performanceAlert.type)
        logger.info(`Posted ${performanceAlert.type} performance alert for ${wallet}`)
      }
    }
  }

  private trimCheckedMarkets(): void {
    if (this.checkedMarkets.size <= 1000) {
      return
    }
    const retained = [...this.checkedMarkets].slice(-500)
    this.checkedMarkets.clear()
    for (const conditionId of retained) {
      this.checkedMarkets.add(conditionId)
    }
  }
}
