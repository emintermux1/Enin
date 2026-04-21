import { config } from './src/config'
import { DataApi } from './src/api/data-api'
import { GammaApi } from './src/api/gamma-api'
import { HashdiveApi } from './src/api/hashdive-api'
import { ChannelPoster } from './src/telegram/channel-poster'
import { EnrichedTrade, PolymarketTrade, TraderType } from './src/types'
import { TradeEnricher } from './src/tracker/trade-enricher'
import { WalletManager } from './src/tracker/wallet-manager'
import { logger } from './src/utils/logger'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isTradeEligible(trade: PolymarketTrade): boolean {
  const price = numeric(trade.price)
  return (
    numeric(trade.usdcSize) >= config.tracking.minTradeSize &&
    price >= 0.03 &&
    price <= 0.93
  )
}

function cloneEnrichedTrade(trade: EnrichedTrade): EnrichedTrade {
  return {
    ...trade,
    trade: { ...trade.trade },
    traderStats: { ...trade.traderStats },
    marketInfo: { ...trade.marketInfo },
    holderStats: { ...trade.holderStats },
    traderTypes: [...trade.traderTypes],
    risk: { ...trade.risk },
    hashdiveProfile: trade.hashdiveProfile
      ? { ...trade.hashdiveProfile }
      : undefined,
    insiderScore: trade.insiderScore
      ? { ...trade.insiderScore, signals: [...trade.insiderScore.signals] }
      : undefined,
    unusualScore: trade.unusualScore
      ? { ...trade.unusualScore, signals: [...trade.unusualScore.signals] }
      : undefined,
  }
}

function forcePrimaryType(trade: EnrichedTrade, primaryType: TraderType): EnrichedTrade {
  const cloned = cloneEnrichedTrade(trade)
  cloned.primaryType = primaryType
  if (!cloned.traderTypes.includes(primaryType)) {
    cloned.traderTypes.unshift(primaryType)
  }
  return cloned
}

function describeTrade(label: string, trade: EnrichedTrade): string {
  const name =
    trade.trade.name ||
    trade.trade.pseudonym ||
    trade.trade.proxyWallet.slice(0, 10)
  return [
    label,
    `wallet=${name}`,
    `market=${trade.trade.title}`,
    `amount=$${Math.round(numeric(trade.trade.usdcSize)).toLocaleString('en-US')}`,
    `portfolio=$${Math.round(trade.traderStats.portfolioValue).toLocaleString('en-US')}`,
    `winRate=${Math.round(trade.traderStats.winRate)}%`,
    `closed=${trade.traderStats.closedPositions}`,
    `fresh=${trade.isFreshWallet}`,
    `type=${trade.primaryType}`,
  ].join(' | ')
}

async function main() {
  logger.info('=== Multi-type test: posting WHALE, INSIDER, FRESH WALLET variants ===')

  const poster = new ChannelPoster(config.telegram)
  const dataApi = new DataApi(config.api)
  const gammaApi = new GammaApi(config.api)
  const walletManager = new WalletManager(dataApi, config.tracking)
  const hashdiveApi = config.api.hashdiveApiKey
    ? new HashdiveApi(config.api.hashdiveApiKey)
    : undefined
  const enricher = new TradeEnricher(dataApi, gammaApi, walletManager, hashdiveApi)

  const launchPromise = poster.launch()
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 15000)
  )
  try {
    await Promise.race([launchPromise, timeoutPromise])
  } catch {}

  try {
    await walletManager.refreshIfNeeded(true)
    const wallets = walletManager
      .getWallets()
      .sort((left, right) => right.pnl + right.vol - (left.pnl + left.vol))

    logger.info(`Loaded ${wallets.length} tracked wallets`)

    let whaleCandidate: EnrichedTrade | null = null
    let insiderCandidate: EnrichedTrade | null = null
    let freshCandidate: EnrichedTrade | null = null
    const usedTransactions = new Set<string>()

    for (const [walletIndex, wallet] of wallets.entries()) {
      if (whaleCandidate && insiderCandidate && freshCandidate) {
        break
      }

      logger.info(
        `Scanning wallet ${walletIndex + 1}/${wallets.length}: ${wallet.userName || wallet.proxyWallet}`
      )
      const activity = await dataApi.getActivity(wallet.proxyWallet, 8).catch((error) => {
        logger.warn(`Activity fetch failed for ${wallet.proxyWallet}`, error)
        return [] as PolymarketTrade[]
      })
      const eligibleTrades = activity.filter(isTradeEligible)

      for (const trade of eligibleTrades) {
        if (usedTransactions.has(trade.transactionHash)) {
          continue
        }

        let enriched: EnrichedTrade
        try {
          enriched = await enricher.enrichTrade(trade)
        } catch (error) {
          logger.warn(`Failed to enrich trade ${trade.transactionHash}`, error)
          continue
        }

        usedTransactions.add(trade.transactionHash)
        logger.info(describeTrade('Candidate', enriched))

        if (!whaleCandidate && enriched.traderStats.portfolioValue > 500_000) {
          whaleCandidate = enriched
          logger.info(describeTrade('Selected WHALE source', whaleCandidate))
        }
        if (
          !insiderCandidate &&
          enriched.traderStats.winRate >= 80 &&
          enriched.traderStats.closedPositions >= 5
        ) {
          insiderCandidate = enriched
          logger.info(describeTrade('Selected INSIDER source', insiderCandidate))
        }
        if (!freshCandidate) {
          freshCandidate = enriched
          logger.info(describeTrade('Selected FRESH source', freshCandidate))
        }

        if (whaleCandidate && insiderCandidate && freshCandidate) {
          break
        }
      }
    }

    if (!whaleCandidate) {
      throw new Error('Failed to find a whale trade with portfolio > $500K')
    }
    if (!insiderCandidate) {
      throw new Error('Failed to find an insider-style trade with high win rate')
    }
    if (!freshCandidate) {
      throw new Error('Failed to find a source trade for fresh wallet variant')
    }

    const whalePost = forcePrimaryType(whaleCandidate, 'WHALE')
    const insiderPost = forcePrimaryType(insiderCandidate, 'INSIDER')
    const freshPost = cloneEnrichedTrade(freshCandidate)
    freshPost.isFreshWallet = true

    const posts: Array<{ label: string; trade: EnrichedTrade }> = [
      { label: 'WHALE', trade: whalePost },
      { label: 'INSIDER', trade: insiderPost },
      { label: 'FRESH WALLET', trade: freshPost },
    ]

    for (const [index, post] of posts.entries()) {
      logger.info(describeTrade(`Posting ${post.label}`, post.trade))
      await poster.postAlert(post.trade)
      logger.info(`✅ Posted ${post.label}`)
      if (index < posts.length - 1) {
        await delay(3000)
      }
    }
  } finally {
    poster.stop()
  }

  process.exit(0)
}

main().catch((error) => {
  logger.error('Multi-type test failed:', error)
  process.exit(1)
})
