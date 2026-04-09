import Database from 'better-sqlite3'
import { DataApi } from '../api/data-api'
import { ChannelPoster } from '../telegram/channel-poster'
import { LeaderboardEntry, LeaderboardTrader } from '../types'
import { logger } from '../utils/logger'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class DailyLeaderboard {
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private pinnedMessageId: number | null = null
  private readonly refreshIntervalMs = 6 * 60 * 60 * 1000
  private readonly minPnl = 100_000
  private readonly minLoss = -100_000
  private readonly leaderboardFetchLimit = 30

  constructor(
    private readonly dataApi: DataApi,
    private readonly poster: ChannelPoster,
    private readonly db: Database.Database
  ) {}

  start(): void {
    this.loadPinnedMessageId()
    this.startupTimer = setTimeout(() => void this.refresh(), 30_000)
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

  private loadPinnedMessageId(): void {
    try {
      const row = this.db
        .prepare('SELECT value FROM bot_state WHERE key = ?')
        .get('leaderboard_message_id') as { value?: string } | undefined
      if (!row?.value) {
        return
      }
      const messageId = Number(row.value)
      if (Number.isFinite(messageId) && messageId > 0) {
        this.pinnedMessageId = messageId
      }
    } catch (error) {
      logger.warn('Failed to load saved leaderboard message id', error)
    }
  }

  private savePinnedMessageId(messageId: number): void {
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)')
        .run('leaderboard_message_id', String(messageId))
    } catch (error) {
      logger.warn('Failed to persist leaderboard message id', error)
    }
  }

  private async refresh(): Promise<void> {
    try {
      const leaderboard = await this.dataApi.getLeaderboard(
        'OVERALL',
        'DAY',
        'PNL',
        this.leaderboardFetchLimit
      )

      const winnerEntries = leaderboard
        .filter((entry) => Number(entry.pnl || 0) >= this.minPnl)
        .sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0))
        .slice(0, 5)

      const loserEntries = leaderboard
        .filter((entry) => Number(entry.pnl || 0) <= this.minLoss)
        .sort((a, b) => Number(a.pnl || 0) - Number(b.pnl || 0))
        .slice(0, 5)

      if (winnerEntries.length === 0 && loserEntries.length === 0) {
        logger.info('Daily leaderboard: no traders with ±$100K daily PnL')
        return
      }

      const uniqueEntries = new Map<string, LeaderboardEntry>()
      for (const entry of [...winnerEntries, ...loserEntries]) {
        if (!entry.proxyWallet) {
          continue
        }
        uniqueEntries.set(entry.proxyWallet.toLowerCase(), entry)
      }

      const enrichedTraders = new Map<string, LeaderboardTrader>()
      for (const entry of uniqueEntries.values()) {
        const trader = await this.enrichTrader(entry)
        enrichedTraders.set(entry.proxyWallet.toLowerCase(), trader)
        await delay(100)
      }

      const winners = winnerEntries
        .map((entry, index) => {
          const trader = enrichedTraders.get(entry.proxyWallet.toLowerCase())
          if (!trader) {
            return null
          }
          return { ...trader, rank: index + 1 }
        })
        .filter((trader): trader is LeaderboardTrader => Boolean(trader))

      const losers = loserEntries
        .map((entry, index) => {
          const trader = enrichedTraders.get(entry.proxyWallet.toLowerCase())
          if (!trader) {
            return null
          }
          return { ...trader, rank: winners.length + index + 1 }
        })
        .filter((trader): trader is LeaderboardTrader => Boolean(trader))

      if (this.pinnedMessageId) {
        try {
          await this.poster.editLeaderboard(this.pinnedMessageId, winners, losers)
          logger.info(`Daily leaderboard updated (message ${this.pinnedMessageId})`)
          return
        } catch (error: any) {
          const errorMessage = String(error?.message || error)
          if (
            errorMessage.includes('message to edit not found') ||
            errorMessage.includes('message identifier is not specified')
          ) {
            logger.warn(
              `Saved leaderboard message ${this.pinnedMessageId} is no longer editable, posting a new one`
            )
            this.pinnedMessageId = null
          } else {
            throw error
          }
        }
      }

      const messageId = await this.poster.postLeaderboard(winners, losers)
      this.pinnedMessageId = messageId
      this.savePinnedMessageId(messageId)
      logger.info(`Daily leaderboard posted and pinned (message ${messageId})`)
    } catch (error) {
      logger.warn('Daily leaderboard refresh failed', error)
    }
  }

  private async enrichTrader(entry: LeaderboardEntry): Promise<LeaderboardTrader> {
    const wallet = entry.proxyWallet
    const [positions, closedPositions] = await Promise.all([
      this.dataApi.getPositions(wallet, 500, 200).catch(() => []),
      this.dataApi.getClosedPositions(wallet, 200).catch(() => []),
    ])
    const wins = closedPositions.filter((position) => Number(position.realizedPnl || 0) > 0).length

    return {
      rank: 0,
      name: entry.userName || wallet.slice(0, 10),
      wallet,
      xUsername: entry.xUsername,
      pnl: Number(entry.pnl || 0),
      wins,
      totalBets: closedPositions.length,
      livePositions: positions.length,
    }
  }
}
