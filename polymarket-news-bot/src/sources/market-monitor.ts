import { config } from '../config'
import { NewsDatabase } from '../db/database'
import { MarketData, PriceMover } from '../types'
import { logger } from '../utils/logger'
import { PolymarketApi } from './polymarket-api'

function bestProbability(prices: number[]): number {
  return prices.reduce((max, value) => (value > max ? value : max), 0)
}

export class MarketMonitor {
  constructor(
    private readonly polymarketApi: PolymarketApi,
    private readonly db: NewsDatabase
  ) {}

  async getTrendingMarkets(): Promise<MarketData[]> {
    const markets = await this.polymarketApi.getTopEvents(30, 0)
    return markets
      .filter(
        (market) => market.volume24hr >= config.monitoring.minVolumeForTrending
      )
      .filter(
        (market) =>
          !this.db.hasRecentMarketPost(
            'market_spotlight',
            market.slug,
            6 * 60 * 60 * 1000
          )
      )
      .slice(0, 8)
  }

  async getNewNotableMarkets(): Promise<MarketData[]> {
    const markets = await this.polymarketApi.getNewestEvents(40)
    const fresh: MarketData[] = []

    for (const market of markets) {
      const alreadyKnown = this.db.isKnownMarket(market.id)
      if (alreadyKnown) {
        continue
      }
      if (market.volume < config.monitoring.minVolumeForNewMarket) {
        continue
      }
      const createdAt = market.createdAt
        ? new Date(market.createdAt).getTime()
        : 0
      if (createdAt && createdAt < Date.now() - 72 * 60 * 60 * 1000) {
        continue
      }
      fresh.push(market)
      this.db.rememberMarket(market)
    }

    return fresh.slice(0, 6)
  }

  async getPriceMovers(): Promise<PriceMover[]> {
    const markets = await this.polymarketApi.getTopEvents(30, 0)
    const movers: PriceMover[] = []

    for (const market of markets) {
      try {
        const latestSnapshot = this.db.getLatestSnapshot(market.id)
        const currentProbability = bestProbability(market.outcomePrices)
        if (latestSnapshot && latestSnapshot.outcomePrices.length > 0) {
          const previousProbability = bestProbability(
            latestSnapshot.outcomePrices
          )
          const delta = (currentProbability - previousProbability) * 100
          if (Math.abs(delta) >= config.monitoring.minPriceChangePercent) {
            movers.push({
              market,
              change: Math.abs(delta),
              direction: delta >= 0 ? 'up' : 'down',
            })
          }
        }
        this.db.saveMarketSnapshot(market)
      } catch (error) {
        logger.warn(
          `Failed to evaluate price movement for ${market.slug}`,
          error
        )
      }
    }

    return movers
      .filter(
        (item) =>
          !this.db.hasRecentMarketPost(
            'price_mover',
            item.market.slug,
            90 * 60 * 1000
          )
      )
      .sort((a, b) => b.change - a.change)
      .slice(0, 5)
  }

  async getResolvedMarkets(): Promise<MarketData[]> {
    const markets = await this.polymarketApi.getResolvedMarkets(12)
    return markets
      .filter(
        (market) =>
          !this.db.hasRecentMarketPost(
            'resolution',
            market.slug,
            365 * 24 * 60 * 60 * 1000
          )
      )
      .slice(0, 10)
  }
}
