import Database from 'better-sqlite3'
import { ChannelPoster } from '../telegram/channel-poster'
import { logger } from '../utils/logger'

interface MarketHeat {
  marketQuestion: string
  conditionId: string
  eventSlug: string
  tradeCount: number
  totalVolume: number
  uniqueWallets: number
  avgAmount: number
  latestTimestamp: number
}

export class MarketHeatmap {
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private readonly refreshIntervalMs = 12 * 60 * 60 * 1000

  constructor(
    private readonly poster: ChannelPoster,
    private readonly db: Database.Database,
  ) {}

  start(): void {
    this.startupTimer = setTimeout(() => void this.refresh(), 2 * 60 * 1000)
    this.timer = setInterval(() => void this.refresh(), this.refreshIntervalMs)
  }

  stop(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async refresh(): Promise<void> {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - 12 * 60 * 60
      const rows = this.db
        .prepare(
          `
            SELECT
              market_question as marketQuestion,
              condition_id as conditionId,
              COALESCE(MAX(NULLIF(event_slug, '')), '') as eventSlug,
              COUNT(*) as tradeCount,
              SUM(amount) as totalVolume,
              COUNT(DISTINCT wallet) as uniqueWallets,
              AVG(amount) as avgAmount,
              MAX(timestamp) as latestTimestamp
            FROM wallet_trades
            WHERE timestamp > ?
            GROUP BY condition_id
            HAVING COUNT(*) >= 2
            ORDER BY SUM(amount) DESC
            LIMIT 5
          `
        )
        .all(cutoff) as MarketHeat[]

      if (rows.length === 0) {
        logger.info('Market heatmap: no qualifying markets in last 12h')
        return
      }

      await this.poster.postHeatmap(rows)
      logger.info(`Market heatmap posted with ${rows.length} markets`)
    } catch (error) {
      logger.warn('Market heatmap refresh failed', error)
    }
  }
}
