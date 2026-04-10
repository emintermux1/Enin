import Database from 'better-sqlite3'
import { logger } from '../utils/logger'

export interface SimulatedTrade {
  wallet: string
  conditionId: string
  marketQuestion: string
  side: string
  entryPrice: number
  exitPrice: number | null
  simulatedAmount: number
  simulatedPnl: number | null
  status: 'open' | 'resolved_win' | 'resolved_loss'
  alertTimestamp: number
  resolvedTimestamp: number | null
}

export interface BacktestResult {
  wallet: string
  totalTrades: number
  resolvedTrades: number
  wins: number
  losses: number
  totalPnl: number
  winRate: number
  consistencyScore: 'High' | 'Medium' | 'Low'
  trades: SimulatedTrade[]
}

export interface PerformanceAlertTrigger {
  type: 'profitable' | 'losing' | 'elite'
  pnl: number
  winRate: number
  resolvedTrades: number
}

interface TraderPerformanceRow {
  wallet: string
  conditionId: string
  marketQuestion: string
  side: string
  entryPrice: number
  exitPrice: number | null
  simulatedAmount: number
  simulatedPnl: number | null
  status: 'open' | 'resolved_win' | 'resolved_loss'
  alertTimestamp: number
  resolvedTimestamp: number | null
}

interface OpenTradeRow {
  id: number
  wallet: string
  side: string
  entryPrice: number
}

function normalizeOutcome(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function toWalletFallback(wallet: string): string {
  if (!wallet) {
    return 'Unknown wallet'
  }
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function isWinningSide(side: string, winningOutcome: string): boolean {
  const normalizedSide = normalizeOutcome(side)
  const normalizedWinningOutcome = normalizeOutcome(winningOutcome)

  if (normalizedSide && normalizedSide === normalizedWinningOutcome) {
    return true
  }

  const sideIndex = Number.parseInt(side, 10)
  const winningIndex = Number.parseInt(winningOutcome, 10)
  return Number.isInteger(sideIndex) && Number.isInteger(winningIndex) && sideIndex === winningIndex
}

export class TraderPerformanceRepo {
  private readonly recordAlertStmt: Database.Statement
  private readonly getOpenTradesForMarketStmt: Database.Statement
  private readonly resolveTradeStmt: Database.Statement
  private readonly getWalletAlertCountStmt: Database.Statement
  private readonly getResolvedTradesStmt: Database.Statement
  private readonly getWalletNameStmt: Database.Statement
  private readonly getBotStateStmt: Database.Statement
  private readonly setBotStateStmt: Database.Statement
  private readonly clearBotStateStmt: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.recordAlertStmt = db.prepare(`
      INSERT INTO trader_performance (
        wallet,
        condition_id,
        market_question,
        side,
        entry_price,
        alert_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    this.getOpenTradesForMarketStmt = db.prepare(`
      SELECT
        id,
        wallet,
        side,
        entry_price AS entryPrice
      FROM trader_performance
      WHERE condition_id = ? AND status = 'open'
    `)

    this.resolveTradeStmt = db.prepare(`
      UPDATE trader_performance
      SET
        exit_price = ?,
        simulated_pnl = ?,
        status = ?,
        resolved_timestamp = ?
      WHERE id = ?
    `)

    this.getWalletAlertCountStmt = db.prepare(`
      SELECT COUNT(*) AS count
      FROM trader_performance
      WHERE wallet = ?
    `)

    this.getResolvedTradesStmt = db.prepare(`
      SELECT
        wallet,
        condition_id AS conditionId,
        market_question AS marketQuestion,
        side,
        entry_price AS entryPrice,
        exit_price AS exitPrice,
        simulated_amount AS simulatedAmount,
        simulated_pnl AS simulatedPnl,
        status,
        alert_timestamp AS alertTimestamp,
        resolved_timestamp AS resolvedTimestamp
      FROM trader_performance
      WHERE wallet = ? AND status IN ('resolved_win', 'resolved_loss')
      ORDER BY resolved_timestamp DESC, id DESC
      LIMIT 10
    `)

    this.getWalletNameStmt = db.prepare(`
      SELECT trader_name AS traderName
      FROM wallet_trades
      WHERE wallet = ? AND trader_name != ''
      ORDER BY timestamp DESC
      LIMIT 1
    `)

    this.getBotStateStmt = db.prepare(`
      SELECT value
      FROM bot_state
      WHERE key = ?
    `)

    this.setBotStateStmt = db.prepare(`
      INSERT OR REPLACE INTO bot_state (key, value)
      VALUES (?, ?)
    `)

    this.clearBotStateStmt = db.prepare(`
      DELETE FROM bot_state
      WHERE key = ?
    `)
  }

  recordAlert(
    wallet: string,
    conditionId: string,
    marketQuestion: string,
    side: string,
    entryPrice: number,
    timestamp: number
  ): void {
    try {
      this.recordAlertStmt.run(
        wallet.toLowerCase(),
        conditionId,
        marketQuestion,
        side,
        entryPrice,
        timestamp,
      )
    } catch (error) {
      logger.warn(`Failed to record trader performance alert for ${wallet}`, error)
    }
  }

  resolveTradesForMarket(
    conditionId: string,
    winningOutcome: string,
    resolvedTimestamp: number
  ): string[] {
    try {
      return this.db.transaction(() => {
        const openTrades = this.getOpenTradesForMarketStmt.all(conditionId) as OpenTradeRow[]
        const updatedWallets = new Set<string>()

        for (const trade of openTrades) {
          const safeEntryPrice = Math.max(trade.entryPrice || 0.01, 0.01)
          const won = isWinningSide(trade.side, winningOutcome)
          const simulatedPnl = won
            ? (1 / safeEntryPrice - 1) * 100
            : -100

          this.resolveTradeStmt.run(
            won ? 1 : 0,
            simulatedPnl,
            won ? 'resolved_win' : 'resolved_loss',
            resolvedTimestamp,
            trade.id,
          )
          updatedWallets.add(trade.wallet)
        }

        if (updatedWallets.size > 0) {
          logger.info(
            `Resolved ${updatedWallets.size} trader performance wallet(s) for market ${conditionId}`
          )
        }

        return [...updatedWallets]
      })()
    } catch (error) {
      logger.warn(`Failed to resolve trader performance for market ${conditionId}`, error)
      return []
    }
  }

  getWalletAlertCount(wallet: string): number {
    const row = this.getWalletAlertCountStmt.get(wallet.toLowerCase()) as { count: number } | undefined
    return row?.count ?? 0
  }

  getBacktest(wallet: string): BacktestResult | null {
    const trades = this.getResolvedTradesStmt.all(wallet.toLowerCase()) as TraderPerformanceRow[]
    if (trades.length === 0) {
      return null
    }

    const wins = trades.filter((trade) => trade.status === 'resolved_win').length
    const losses = trades.filter((trade) => trade.status === 'resolved_loss').length
    const totalPnl = trades.reduce((sum, trade) => sum + (trade.simulatedPnl ?? 0), 0)
    const resolvedTrades = trades.length
    const winRate = resolvedTrades > 0 ? (wins / resolvedTrades) * 100 : 0
    const maxLossStreak = this.getMaxLossStreak(trades)

    return {
      wallet: wallet.toLowerCase(),
      totalTrades: trades.length,
      resolvedTrades,
      wins,
      losses,
      totalPnl,
      winRate,
      consistencyScore: this.getConsistencyScore(winRate, maxLossStreak),
      trades,
    }
  }

  getWalletDisplayName(wallet: string): string {
    const row = this.getWalletNameStmt.get(wallet.toLowerCase()) as { traderName?: string } | undefined
    return row?.traderName || toWalletFallback(wallet)
  }

  shouldPostBacktest(wallet: string, alertCount: number): boolean {
    const milestone = Math.floor(alertCount / 5) * 5
    if (milestone < 10) {
      return false
    }

    const lastPosted = Number(this.getStateValue(this.getBacktestStateKey(wallet)) || 0)
    return milestone > lastPosted
  }

  markBacktestPosted(wallet: string, alertCount: number): void {
    const milestone = Math.floor(alertCount / 5) * 5
    if (milestone < 10) {
      return
    }
    this.setStateValue(this.getBacktestStateKey(wallet), String(milestone))
  }

  getPendingPerformanceAlerts(wallet: string, backtest: BacktestResult | null): PerformanceAlertTrigger[] {
    if (!backtest || backtest.resolvedTrades === 0) {
      this.clearPerformanceAlertState(wallet, 'profitable')
      this.clearPerformanceAlertState(wallet, 'losing')
      this.clearPerformanceAlertState(wallet, 'elite')
      return []
    }

    const currentStates: Record<PerformanceAlertTrigger['type'], boolean> = {
      profitable: backtest.totalPnl > 500,
      losing: backtest.totalPnl < -500,
      elite: backtest.winRate > 80 && backtest.resolvedTrades >= 10,
    }

    const pending: PerformanceAlertTrigger[] = []

    ;(['profitable', 'losing', 'elite'] as const).forEach((type) => {
      const wasActive = this.getStateValue(this.getPerformanceAlertStateKey(wallet, type)) === '1'
      const isActive = currentStates[type]

      if (!isActive && wasActive) {
        this.clearPerformanceAlertState(wallet, type)
        return
      }

      if (isActive && !wasActive) {
        pending.push({
          type,
          pnl: backtest.totalPnl,
          winRate: backtest.winRate,
          resolvedTrades: backtest.resolvedTrades,
        })
      }
    })

    if (pending.some((alert) => alert.type === 'elite')) {
      return pending.filter((alert) => alert.type !== 'profitable')
    }

    return pending
  }

  markPerformanceAlertPosted(wallet: string, type: PerformanceAlertTrigger['type']): void {
    this.setStateValue(this.getPerformanceAlertStateKey(wallet, type), '1')
    if (type === 'elite') {
      this.setStateValue(this.getPerformanceAlertStateKey(wallet, 'profitable'), '1')
    }
  }

  private getMaxLossStreak(trades: SimulatedTrade[]): number {
    let maxLossStreak = 0
    let currentLossStreak = 0

    for (const trade of [...trades].reverse()) {
      if (trade.status === 'resolved_loss') {
        currentLossStreak += 1
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak)
      } else {
        currentLossStreak = 0
      }
    }

    return maxLossStreak
  }

  private getConsistencyScore(
    winRate: number,
    maxLossStreak: number
  ): BacktestResult['consistencyScore'] {
    if (winRate >= 70 && maxLossStreak < 3) {
      return 'High'
    }

    if (winRate < 50 || maxLossStreak >= 4) {
      return 'Low'
    }

    return 'Medium'
  }

  private getBacktestStateKey(wallet: string): string {
    return `trader_performance_backtest:${wallet.toLowerCase()}`
  }

  private getPerformanceAlertStateKey(
    wallet: string,
    type: PerformanceAlertTrigger['type']
  ): string {
    return `trader_performance_threshold:${type}:${wallet.toLowerCase()}`
  }

  private clearPerformanceAlertState(
    wallet: string,
    type: PerformanceAlertTrigger['type']
  ): void {
    this.clearBotStateStmt.run(this.getPerformanceAlertStateKey(wallet, type))
  }

  private getStateValue(key: string): string | null {
    const row = this.getBotStateStmt.get(key) as { value?: string } | undefined
    return row?.value ?? null
  }

  private setStateValue(key: string, value: string): void {
    this.setBotStateStmt.run(key, value)
  }
}
