import Database from 'better-sqlite3'

export interface WalletTradeRecord {
  wallet: string
  conditionId: string
  side: string
  amount: number
  price: number
  outcome: string
  marketQuestion: string
  timestamp: number
  alerted: number
  traderName: string
  primaryType: string
  potentialWin: number
  multiplier: number
}

export interface WalletPattern {
  totalTrades: number
  marketsTraded: number
  avgTradeSize: number
  prefersHighRisk: boolean
  prefersBuySide: boolean
  recentFrequency: number
  repeatMarkets: string[]
  isRepeatTrader: boolean
}

interface WalletTradeRow {
  wallet: string
  conditionId: string
  side: string
  amount: number
  price: number
  outcome: string
  marketQuestion: string
  timestamp: number
  alerted: number
  traderName: string
  primaryType: string
  potentialWin: number
  multiplier: number
}

interface WalletTradePatternRow {
  condition_id: string
  side: string
  amount: number
  price: number
  timestamp: number
}

export class WalletTradeRepo {
  private readonly insertStmt: Database.Statement
  private readonly getByWalletStmt: Database.Statement
  private readonly getPatternStmt: Database.Statement
  private readonly markAlertedStmt: Database.Statement
  private readonly getAlertedTradesForConditionStmt: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT OR IGNORE INTO wallet_trades (
        wallet,
        condition_id,
        side,
        amount,
        price,
        outcome,
        market_question,
        timestamp,
        alerted,
        trader_name,
        primary_type,
        potential_win,
        multiplier
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.getByWalletStmt = db.prepare(`
      SELECT
        wallet,
        condition_id AS conditionId,
        side,
        amount,
        price,
        outcome,
        market_question AS marketQuestion,
        timestamp,
        alerted,
        trader_name AS traderName,
        primary_type AS primaryType,
        potential_win AS potentialWin,
        multiplier
      FROM wallet_trades
      WHERE wallet = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    this.getPatternStmt = db.prepare(`
      SELECT condition_id, side, amount, price, timestamp
      FROM wallet_trades
      WHERE wallet = ? AND timestamp > ?
      ORDER BY timestamp DESC
    `)
    this.markAlertedStmt = db.prepare(`
      UPDATE wallet_trades
      SET alerted = 1
      WHERE wallet = ? AND condition_id = ? AND timestamp = ?
    `)
    this.getAlertedTradesForConditionStmt = db.prepare(`
      SELECT
        wallet,
        condition_id AS conditionId,
        side,
        amount,
        price,
        outcome,
        market_question AS marketQuestion,
        timestamp,
        alerted,
        trader_name AS traderName,
        primary_type AS primaryType,
        potential_win AS potentialWin,
        multiplier
      FROM wallet_trades
      WHERE condition_id = ? AND alerted = 1
      ORDER BY amount DESC
    `)
  }

  record(trade: WalletTradeRecord): void {
    this.insertStmt.run(
      trade.wallet.toLowerCase(),
      trade.conditionId,
      trade.side,
      trade.amount,
      trade.price,
      trade.outcome,
      trade.marketQuestion,
      trade.timestamp,
      trade.alerted,
      trade.traderName,
      trade.primaryType,
      trade.potentialWin,
      trade.multiplier,
    )
  }

  getRecentTrades(wallet: string, limit = 100): WalletTradeRecord[] {
    return this.getByWalletStmt.all(wallet.toLowerCase(), limit) as WalletTradeRecord[]
  }

  markAlerted(wallet: string, conditionId: string, timestamp: number): void {
    this.markAlertedStmt.run(wallet.toLowerCase(), conditionId, timestamp)
  }

  getAlertedTradesForCondition(conditionId: string): WalletTradeRecord[] {
    return this.getAlertedTradesForConditionStmt.all(conditionId) as WalletTradeRecord[]
  }

  analyzePattern(wallet: string, lookbackDays = 30): WalletPattern {
    const cutoff = Math.floor(Date.now() / 1000) - lookbackDays * 86400
    const trades = this.getPatternStmt.all(wallet.toLowerCase(), cutoff) as WalletTradePatternRow[]

    if (trades.length === 0) {
      return {
        totalTrades: 0,
        marketsTraded: 0,
        avgTradeSize: 0,
        prefersHighRisk: false,
        prefersBuySide: false,
        recentFrequency: 0,
        repeatMarkets: [],
        isRepeatTrader: false,
      }
    }

    const uniqueMarkets = new Set(trades.map((trade) => trade.condition_id))
    const buys = trades.filter((trade) => trade.side === 'BUY').length
    const highRisk = trades.filter((trade) => trade.price < 0.3).length
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400
    const recentTrades = trades.filter((trade) => trade.timestamp > sevenDaysAgo)
    const marketCounts: Record<string, number> = {}

    for (const trade of trades) {
      marketCounts[trade.condition_id] = (marketCounts[trade.condition_id] || 0) + 1
    }

    const repeatMarkets = Object.entries(marketCounts)
      .filter(([, count]) => count > 1)
      .map(([conditionId]) => conditionId)

    return {
      totalTrades: trades.length,
      marketsTraded: uniqueMarkets.size,
      avgTradeSize: trades.reduce((sum, trade) => sum + trade.amount, 0) / trades.length,
      prefersHighRisk: highRisk / trades.length > 0.5,
      prefersBuySide: buys / trades.length > 0.7,
      recentFrequency: recentTrades.length / 7,
      repeatMarkets,
      isRepeatTrader: repeatMarkets.length > 2,
    }
  }
}
