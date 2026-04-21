import fs from 'node:fs'
import path from 'node:path'
import { Telegraf } from 'telegraf'
import { config } from './src/config'
import { DataApi } from './src/api/data-api'
import { GammaApi } from './src/api/gamma-api'
import { HashdiveApi } from './src/api/hashdive-api'
import { ChannelPoster } from './src/telegram/channel-poster'
import { WhaleTracker } from './src/tracker/whale-tracker'
import { TradeEnricher } from './src/tracker/trade-enricher'
import { WalletManager } from './src/tracker/wallet-manager'
import { EnrichedTrade, PolymarketTrade } from './src/types'
import { logger } from './src/utils/logger'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type RequirementKey =
  | 'whale'
  | 'insiderLike'
  | 'lowRisk'
  | 'midRisk'
  | 'highRisk'
  | 'freshWallet'

interface Requirement {
  key: RequirementKey
  label: string
  matches: (trade: EnrichedTrade) => boolean
}

interface Candidate {
  enriched: EnrichedTrade
  walletIndex: number
  tradeIndex: number
}

const BANNER_CAPTION =
  '🐋 Polymarket whale & insider alerts\n\nTrack smart money before the market reacts.\nReal-time whale trades • Insider detection • Risk scoring\n\n@polymarketalerthub'

const TARGET_COUNT = 6
const MAX_WALLETS_TO_SCAN = 40
const ACTIVITY_LIMIT = 20
const MIN_TRADE_SIZE = 10_000
const MIN_PRICE = 0.03
const MAX_PRICE = 0.93

const requirements: Requirement[] = [
  {
    key: 'whale',
    label: 'Whale trade',
    matches: (trade) => isWhaleTrade(trade),
  },
  {
    key: 'insiderLike',
    label: 'Insider-like high win rate trade',
    matches: (trade) => isInsiderLikeTrade(trade),
  },
  {
    key: 'lowRisk',
    label: 'High-price / LOW risk trade',
    matches: (trade) => trade.risk.level === 'LOW',
  },
  {
    key: 'midRisk',
    label: 'Mid-price / MED risk trade',
    matches: (trade) => trade.risk.level === 'MED',
  },
  {
    key: 'highRisk',
    label: 'Low-price / HIGH risk trade',
    matches: (trade) => trade.risk.level === 'HIGH',
  },
  {
    key: 'freshWallet',
    label: 'Fresh wallet trade',
    matches: (trade) => trade.isFreshWallet,
  },
]

function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isTradeEligible(trade: PolymarketTrade): boolean {
  const usdcSize = numeric(trade.usdcSize)
  const price = numeric(trade.price)
  return usdcSize >= MIN_TRADE_SIZE && price >= MIN_PRICE && price <= MAX_PRICE
}

function isWhaleTrade(trade: EnrichedTrade): boolean {
  return (
    trade.primaryType === 'WHALE' ||
    trade.traderTypes.includes('WHALE') ||
    trade.traderStats.portfolioValue > 500_000 ||
    numeric(trade.trade.usdcSize) > 50_000
  )
}

function isInsiderLikeTrade(trade: EnrichedTrade): boolean {
  return (
    trade.primaryType === 'INSIDER' ||
    trade.traderTypes.includes('INSIDER') ||
    (trade.traderStats.winRate >= 80 && trade.traderStats.closedPositions >= 5)
  )
}

function isEnrichedTrade(trade: EnrichedTrade | PolymarketTrade): trade is EnrichedTrade {
  return 'trade' in trade
}

function tradeMarketKey(trade: EnrichedTrade | PolymarketTrade): string {
  return isEnrichedTrade(trade) ? trade.trade.conditionId : trade.conditionId
}

function tradeTxKey(trade: EnrichedTrade | PolymarketTrade): string {
  return isEnrichedTrade(trade) ? trade.trade.transactionHash : trade.transactionHash
}

function summarizeTrade(trade: EnrichedTrade): string {
  const price = numeric(trade.trade.price).toFixed(3)
  const amount = numeric(trade.trade.usdcSize).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })
  const wallet =
    trade.trade.name ||
    trade.trade.pseudonym ||
    trade.trade.proxyWallet.slice(0, 10)
  const flags = [
    `primary=${trade.primaryType}`,
    `types=${trade.traderTypes.join(',')}`,
    `risk=${trade.risk.level}`,
    `price=${price}`,
    `amount=$${amount}`,
    `winRate=${Math.round(trade.traderStats.winRate)}%`,
    `portfolio=$${Math.round(trade.traderStats.portfolioValue).toLocaleString('en-US')}`,
    `fresh=${trade.isFreshWallet}`,
    `whales=${trade.holderStats.whalesInMarket}`,
    `insiders=${trade.holderStats.insidersInMarket}`,
  ]
  return `${wallet} | ${trade.trade.title} | ${flags.join(' | ')}`
}

function collectCoverage(trades: EnrichedTrade[]): RequirementKey[] {
  return requirements
    .filter((requirement) => trades.some((trade) => requirement.matches(trade)))
    .map((requirement) => requirement.key)
}

function scoreCandidate(candidate: EnrichedTrade, selected: EnrichedTrade[]): number {
  const selectedPrimaryTypes = new Set(selected.map((trade) => trade.primaryType))
  const selectedRisks = new Set(selected.map((trade) => trade.risk.level))
  const selectedWallets = new Set(
    selected.map((trade) => trade.trade.proxyWallet.toLowerCase())
  )

  let score = 0
  if (!selectedPrimaryTypes.has(candidate.primaryType)) {
    score += 4
  }
  if (!selectedRisks.has(candidate.risk.level)) {
    score += 3
  }
  if (candidate.isFreshWallet && !selected.some((trade) => trade.isFreshWallet)) {
    score += 2
  }
  if (isWhaleTrade(candidate) && !selected.some((trade) => isWhaleTrade(trade))) {
    score += 2
  }
  if (
    isInsiderLikeTrade(candidate) &&
    !selected.some((trade) => isInsiderLikeTrade(trade))
  ) {
    score += 2
  }
  if (!selectedWallets.has(candidate.trade.proxyWallet.toLowerCase())) {
    score += 1
  }
  score += Math.min(numeric(candidate.trade.usdcSize) / 25_000, 4)
  return score
}

function chooseTrades(candidates: Candidate[]): EnrichedTrade[] {
  const selected: EnrichedTrade[] = []
  const usedMarkets = new Set<string>()

  for (const requirement of requirements) {
    const match = candidates.find(
      ({ enriched }) =>
        !usedMarkets.has(tradeMarketKey(enriched)) && requirement.matches(enriched)
    )
    if (!match) {
      continue
    }
    usedMarkets.add(tradeMarketKey(match.enriched))
    selected.push(match.enriched)
  }

  const remaining = candidates
    .map(({ enriched }) => enriched)
    .filter((trade) => !usedMarkets.has(tradeMarketKey(trade)))

  while (selected.length < TARGET_COUNT && remaining.length > 0) {
    remaining.sort(
      (a, b) => scoreCandidate(b, selected) - scoreCandidate(a, selected)
    )
    const next = remaining.shift()
    if (!next) {
      break
    }
    if (usedMarkets.has(tradeMarketKey(next))) {
      continue
    }
    usedMarkets.add(tradeMarketKey(next))
    selected.push(next)
  }

  logger.info('Coverage summary:')
  for (const requirement of requirements) {
    const matched = selected.some((trade) => requirement.matches(trade))
    logger.info(`- ${requirement.label}: ${matched ? 'YES' : 'NO'}`)
  }

  return selected.slice(0, TARGET_COUNT)
}

async function sendBanner(bot: Telegraf, channelId: string): Promise<void> {
  const bannerPath = path.resolve(process.cwd(), 'assets/promo-banner.png')
  if (!fs.existsSync(bannerPath)) {
    logger.warn(`Banner not found at ${bannerPath}; skipping promotional banner send`)
    return
  }

  logger.info(`Sending promotional banner from ${bannerPath}...`)
  await bot.telegram.sendPhoto(
    channelId,
    { source: fs.readFileSync(bannerPath) },
    { caption: BANNER_CAPTION }
  )
  logger.info('✅ Banner sent')
}

async function main() {
  logger.info('=== Multi-Post Test: Sending diverse alerts ===')

  const poster = new ChannelPoster(config.telegram)
  const bot = new Telegraf(config.telegram.botToken)
  const dataApi = new DataApi(config.api)
  const gammaApi = new GammaApi(config.api)
  const walletManager = new WalletManager(dataApi, config.tracking)
  const hashdiveApi = config.api.hashdiveApiKey
    ? new HashdiveApi(config.api.hashdiveApiKey)
    : undefined
  const enricher = new TradeEnricher(dataApi, gammaApi, walletManager, hashdiveApi)
  const tracker = new WhaleTracker(config, async () => undefined)
  const smokeCardPath = path.resolve('/tmp', 'polymarket-whale-multi-post-smoke.png')

  logger.info('Running WhaleTracker startup smoke test to verify fetch pipeline...')
  const smokeTrade = await tracker.runStartupSmokeTest(
    poster.getCardGenerator(),
    smokeCardPath
  )
  logger.info(`Smoke test OK: ${summarizeTrade(smokeTrade)}`)
  if (fs.existsSync(smokeCardPath)) {
    fs.unlinkSync(smokeCardPath)
  }

  await sendBanner(bot, config.telegram.channelId)
  await delay(3000)

  logger.info('Refreshing tracked wallets...')
  await walletManager.refreshIfNeeded(true)
  const wallets = walletManager.getWallets()
  logger.info(`Loaded ${wallets.length} tracked wallets`)

  const candidates: Candidate[] = []
  const seenTransactions = new Set<string>()
  const walletsToScan = wallets.slice(0, MAX_WALLETS_TO_SCAN)

  for (const [walletIndex, wallet] of walletsToScan.entries()) {
    logger.info(
      `Scanning wallet ${walletIndex + 1}/${walletsToScan.length}: ${wallet.userName || wallet.proxyWallet}`
    )

    const activity = await dataApi.getActivity(wallet.proxyWallet, ACTIVITY_LIMIT).catch(
      (error) => {
        logger.warn(`Activity fetch failed for ${wallet.proxyWallet}`, error)
        return [] as PolymarketTrade[]
      }
    )

    logger.info(`Fetched ${activity.length} recent trades for ${wallet.proxyWallet}`)

    const eligible = activity.filter(isTradeEligible)
    logger.info(
      `Eligible trades for ${wallet.proxyWallet}: ${eligible.length} / ${activity.length}`
    )

    for (const [tradeIndex, trade] of eligible.entries()) {
      const txKey = tradeTxKey(trade)
      if (seenTransactions.has(txKey)) {
        continue
      }

      try {
        const enriched = await enricher.enrichTrade(trade)
        seenTransactions.add(txKey)
        candidates.push({ enriched, walletIndex, tradeIndex })
        logger.info(`Candidate ${candidates.length}: ${summarizeTrade(enriched)}`)
      } catch (error) {
        logger.warn(`Failed to enrich trade ${trade.transactionHash}`, error)
      }

      if (
        candidates.length >= 18 &&
        collectCoverage(candidates.map(({ enriched }) => enriched)).length ===
          requirements.length
      ) {
        logger.info(
          'Collected enough candidates with full requirement coverage; stopping scan early'
        )
        break
      }

      await delay(100)
    }

    if (
      candidates.length >= 18 &&
      collectCoverage(candidates.map(({ enriched }) => enriched)).length ===
        requirements.length
    ) {
      break
    }

    await delay(200)
  }

  if (candidates.length === 0) {
    throw new Error('No eligible trades could be enriched from tracked wallets')
  }

  logger.info(`Collected ${candidates.length} candidate trades`)
  const selected = chooseTrades(candidates)

  if (selected.length === 0) {
    throw new Error('Failed to select any trades for posting')
  }

  logger.info(`Posting ${selected.length} alerts to channel...`)
  for (const [index, enriched] of selected.entries()) {
    const traderName =
      enriched.trade.name ||
      enriched.trade.pseudonym ||
      enriched.trade.proxyWallet.slice(0, 10)
    const amount = numeric(enriched.trade.usdcSize).toLocaleString('en-US', {
      maximumFractionDigits: 0,
    })
    logger.info(`--- Post ${index + 1}/${selected.length} ---`)
    logger.info(`Type: ${enriched.primaryType}`)
    logger.info(`All Types: ${enriched.traderTypes.join(', ')}`)
    logger.info(`Risk: ${enriched.risk.level} ${enriched.risk.emoji}`)
    logger.info(`Market: ${enriched.trade.title}`)
    logger.info(`Outcome: ${enriched.trade.outcome}`)
    logger.info(`Trader: ${traderName}`)
    logger.info(`Trader Wallet: ${enriched.trade.proxyWallet}`)
    logger.info(`Amount: $${amount}`)
    logger.info(`Price: ${numeric(enriched.trade.price).toFixed(3)}`)
    logger.info(`Win Rate: ${Math.round(enriched.traderStats.winRate)}%`)
    logger.info(
      `Portfolio Value: $${Math.round(enriched.traderStats.portfolioValue).toLocaleString('en-US')}`
    )
    logger.info(
      `P&L: ${Math.round(enriched.traderStats.totalRealizedPnl).toLocaleString('en-US')}`
    )
    logger.info(`Fresh Wallet: ${enriched.isFreshWallet}`)
    logger.info(`Top Category: ${enriched.topCategory ?? 'n/a'}`)
    logger.info(
      `Holders: whales=${enriched.holderStats.whalesInMarket} insiders=${enriched.holderStats.insidersInMarket} fresh=${enriched.freshWalletsInMarket}`
    )

    await poster.postAlert(enriched)
    logger.info(`✅ Post ${index + 1} sent`)

    if (index < selected.length - 1) {
      await delay(3000)
    }
  }

  logger.info(
    `=== Done! Sent ${selected.length} alerts + banner. Covered: ${collectCoverage(selected).join(', ') || 'none'} ===`
  )
  process.exit(0)
}

main().catch((error) => {
  logger.error('Multi-post test failed:', error)
  process.exit(1)
})
