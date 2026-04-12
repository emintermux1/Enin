import { AppConfig, EnrichedTrade, PolymarketTrade, ScrapedChannelTrade } from '../types';
import Database from 'better-sqlite3';
import { DataApi } from '../api/data-api';
import { GammaApi, GammaMarketLookup } from '../api/gamma-api';
import { HashdiveApi } from '../api/hashdive-api';
import { PolynterApi } from '../api/polynter-api';
import { PolygonscanApi } from '../api/polygonscan-api';
import { WalletTradeRepo } from '../db/wallet-trade-repo';
import { InsiderTracker } from '../db/insider-tracker';
import { TradeEnricher } from './trade-enricher';
import { WalletManager } from './wallet-manager';
import { DedupCache } from './dedup-cache';
import { logger } from '../utils/logger';
import { CardGenerator } from '../image/card-generator';
import { createSourceDedupKey, HashdiveDiscovery } from './hashdive-discovery';
import { NewsCorrelator } from '../classifier/news-correlator';
import { CoordinationDetector } from '../classifier/coordination-detector';
import { PriceHistory } from './price-history';
import { TelegramChannelScraper } from './telegram-channel-scraper';
import { TradeFirehose } from './trade-firehose';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseArray<T>(value: T[] | string | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function slugifyTitle(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'scraped-market';
}

function parseWinRateDetails(raw?: string): { winRate: number; wins: number; losses: number } | null {
  if (!raw) {
    return null;
  }
  const match = raw.match(/([\d.]+)%\s*\((\d+)W-(\d+)L\)/i);
  if (!match) {
    return null;
  }
  const [, winRate, wins, losses] = match;
  return {
    winRate: Number(winRate),
    wins: Number(wins),
    losses: Number(losses),
  };
}

function mapScrapedToPolymarketTrade(scraped: ScrapedChannelTrade): PolymarketTrade {
  return {
    proxyWallet: scraped.walletAddress || '',
    timestamp: scraped.timestamp,
    conditionId: '',
    type: 'TRADE',
    size: scraped.shares || 0,
    usdcSize: scraped.amount,
    transactionHash: `scraped-${scraped.source}-${scraped.messageId}`,
    price: scraped.price,
    asset: '',
    side: scraped.side,
    outcomeIndex: scraped.outcome.toLowerCase().includes('no') ? 1 : 0,
    title: scraped.marketQuestion,
    slug: '',
    icon: '',
    eventSlug: '',
    outcome: scraped.outcome,
    name: scraped.traderName,
    pseudonym: scraped.traderName,
    bio: '',
    profileImage: '',
  };
}

interface WhaleTrackerOptions {
  database?: Database.Database;
  walletTradeRepo?: WalletTradeRepo;
  insiderTracker?: InsiderTracker;
  polygonscanApi?: PolygonscanApi;
  polynterApi?: PolynterApi;
  newsCorrelator?: NewsCorrelator;
  priceHistory?: PriceHistory;
}

export class WhaleTracker {
  private readonly dataApi: DataApi;
  private readonly gammaApi: GammaApi;
  private readonly walletManager: WalletManager;
  private readonly dedupCache = new DedupCache();
  private readonly tradeEnricher: TradeEnricher;
  private readonly coordinationDetector: CoordinationDetector;
  private readonly hashdiveDiscovery?: HashdiveDiscovery;
  private readonly tradeFirehose: TradeFirehose;
  private readonly channelScraper?: TelegramChannelScraper;
  private readonly walletTradeRepo?: WalletTradeRepo;
  private readonly priceHistory?: PriceHistory;
  private readonly lastSeenTimestamps = new Map<string, number>();
  private running = false;
  private processing = false;
  private timer: NodeJS.Timeout | null = null;
  private cursor = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly onTrade: (trade: EnrichedTrade) => Promise<void>,
    options: WhaleTrackerOptions = {},
  ) {
    this.dataApi = new DataApi(config.api);
    this.gammaApi = new GammaApi(config.api);
    this.walletManager = new WalletManager(this.dataApi, config.tracking);
    this.walletTradeRepo = options.walletTradeRepo
      ?? (options.database ? new WalletTradeRepo(options.database) : undefined);
    this.priceHistory = options.priceHistory;
    const hashdiveApi = config.api.hashdiveApiKey
      ? new HashdiveApi(config.api.hashdiveApiKey)
      : undefined;
    this.tradeEnricher = new TradeEnricher(
      this.dataApi,
      this.gammaApi,
      this.walletManager,
      hashdiveApi,
      options.polygonscanApi,
      this.walletTradeRepo,
      options.insiderTracker,
      options.newsCorrelator,
      this.priceHistory,
      options.polynterApi,
    );
    this.coordinationDetector = new CoordinationDetector();
    this.tradeFirehose = new TradeFirehose({
      dataApi: this.dataApi,
      tradeEnricher: this.tradeEnricher,
      coordinationDetector: this.coordinationDetector,
      dedupCache: this.dedupCache,
      priceHistory: this.priceHistory,
      minTradeSize: this.config.tracking.minTradeSize,
      pollIntervalMs: this.config.tracking.firehosePollIntervalMs ?? 5_000,
      onTrade: async (trade) => this.publishTrade(trade),
    });
    if (hashdiveApi) {
      this.hashdiveDiscovery = new HashdiveDiscovery({
        hashdiveApi,
        gammaApi: this.gammaApi,
        walletManager: this.walletManager,
        tradeEnricher: this.tradeEnricher,
        coordinationDetector: this.coordinationDetector,
        dedupCache: this.dedupCache,
        minTradeSize: this.config.tracking.minTradeSize,
        pollIntervalMs: this.config.tracking.hashdivePollIntervalMs,
        onTrade: async (trade) => this.publishTrade(trade),
      });
    }
    if (config.scraping.enabled) {
      this.channelScraper = new TelegramChannelScraper(
        async (scrapedTrade) => {
          await this.processScrapedTrade(scrapedTrade);
        },
        config.scraping.pollIntervalMs,
        config.scraping.channels,
      );
    }
  }

  async runStartupSmokeTest(cardGenerator: CardGenerator, outputPath: string): Promise<EnrichedTrade> {
    logger.info('Running startup smoke test...');
    await this.walletManager.refreshIfNeeded(true);
    const wallets = this.walletManager.getWallets();
    if (wallets.length === 0) {
      throw new Error('Smoke test failed: leaderboard returned zero wallets');
    }
    logger.info(`Smoke test leaderboard OK: ${wallets.length} tracked wallets`);

    let sampleTrade: PolymarketTrade | null = null;
    for (const wallet of wallets.slice(0, 10)) {
      const activity = await this.dataApi.getActivity(wallet.proxyWallet, 10).catch(() => []);
      const eligibleTrade = activity.find(
        (trade) => Number(trade.usdcSize || 0) >= this.config.tracking.minTradeSize,
      );
      if (eligibleTrade) {
        sampleTrade = eligibleTrade;
        logger.info(`Smoke test activity OK: ${wallet.proxyWallet} returned ${activity.length} trades`);
        break;
      }
      await delay(50);
    }

    if (!sampleTrade) {
      throw new Error(
        `Smoke test failed: unable to fetch sample activity >= $${this.config.tracking.minTradeSize} from tracked wallets`,
      );
    }

    const enriched = await this.decorateTrade(await this.tradeEnricher.enrichTrade(sampleTrade));
    const saved = await cardGenerator.saveSampleCard(enriched, outputPath);
    if (!saved) {
      logger.warn('Canvas unavailable — bot will post text-only alerts (no card images)');
    } else {
      logger.info(`Smoke test card OK: ${outputPath}`);
    }
    return enriched;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    await this.walletManager.refreshIfNeeded(true);
    this.initializeLastSeen(this.walletManager.getWallets());
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.tracking.pollIntervalMs);
    await this.tradeFirehose.start();
    await this.hashdiveDiscovery?.start();
    await this.channelScraper?.start();
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.tradeFirehose.stop();
    this.hashdiveDiscovery?.stop();
    this.channelScraper?.stop();
  }

  private async tick(): Promise<void> {
    if (!this.running || this.processing) {
      return;
    }
    this.processing = true;
    try {
      const refreshed = await this.walletManager.refreshIfNeeded();
      if (refreshed) {
        this.initializeLastSeen(this.walletManager.getWallets());
      }
      await this.processNextBatch();
    } catch (error) {
      logger.error('Tracker tick failed', error);
    } finally {
      this.processing = false;
    }
  }

  private initializeLastSeen(wallets: Array<{ proxyWallet: string }>) {
    const now = Math.floor(Date.now() / 1000);
    for (const wallet of wallets) {
      if (!this.lastSeenTimestamps.has(wallet.proxyWallet)) {
        this.lastSeenTimestamps.set(wallet.proxyWallet, now);
      }
    }
  }

  private async processNextBatch(): Promise<void> {
    const wallets = this.walletManager.getWallets();
    if (wallets.length === 0) {
      return;
    }

    const batchSize = Math.min(this.config.tracking.walletBatchSize, wallets.length);
    const batch = Array.from({ length: batchSize }, (_, index) => wallets[(this.cursor + index) % wallets.length]).filter(
      (wallet): wallet is (typeof wallets)[number] => Boolean(wallet),
    );
    this.cursor = (this.cursor + batchSize) % wallets.length;

    const results = await Promise.allSettled(batch.map((wallet) => this.processWallet(wallet.proxyWallet)));
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn('Wallet batch item failed', result.reason);
      }
    }
  }

  private async processWallet(wallet: string): Promise<void> {
    const trades = await this.dataApi.getActivity(wallet, 20).catch((error) => {
      logger.warn(`Activity fetch failed for ${wallet}`, error);
      return [];
    });
    if (trades.length === 0) {
      return;
    }
    if (this.priceHistory) {
      for (const trade of trades) {
        this.priceHistory.record(trade.conditionId || trade.slug, trade.price);
      }
    }

    const lastSeen = this.lastSeenTimestamps.get(wallet) ?? Math.floor(Date.now() / 1000);
    const newestTimestamp = Math.max(lastSeen, ...trades.map((trade) => Number(trade.timestamp || 0)));
    this.lastSeenTimestamps.set(wallet, newestTimestamp);

    const newTrades = trades
      .filter((trade) => Number(trade.timestamp || 0) > lastSeen)
      .filter((trade) => Number(trade.usdcSize || 0) >= this.config.tracking.minTradeSize)
      .filter((trade) => {
        const price = Number(trade.price || 0);
        return price >= 0.03 && price <= 0.93;
      })
      .filter((trade) =>
        this.dedupCache.addManyIfNew([
          trade.transactionHash,
          createSourceDedupKey(trade),
        ]),
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of newTrades) {
      const enriched = await this.decorateTrade(await this.tradeEnricher.enrichTrade(trade));
      enriched.coordinationSignal = this.coordinationDetector.recordAndCheck(
        trade.conditionId,
        trade.proxyWallet,
        trade.side,
        trade.usdcSize,
      );
      await this.publishTrade(enriched);
      await delay(100);
    }
  }

  private async publishTrade(trade: EnrichedTrade): Promise<void> {
    const enriched = trade.walletPattern ? trade : await this.decorateTrade(trade);
    await this.onTrade(enriched);
  }

  private async processScrapedTrade(scrapedTrade: ScrapedChannelTrade): Promise<void> {
    const dedupKey = `scrape:${scrapedTrade.source}:${scrapedTrade.messageId}`;
    if (!this.dedupCache.addIfNew(dedupKey)) {
      return;
    }

    const mappedTrade = await this.resolveScrapedMarket(mapScrapedToPolymarketTrade(scrapedTrade), scrapedTrade);
    if (
      mappedTrade.usdcSize < this.config.tracking.minTradeSize
      || mappedTrade.price < 0.03
      || mappedTrade.price > 0.93
    ) {
      return;
    }

    const amountDedupKey = this.createScrapedAmountDedupKey(mappedTrade);
    if (!this.dedupCache.addIfNew(amountDedupKey)) {
      return;
    }

    const enriched = this.applyScrapedMetadata(
      await this.decorateTrade(await this.tradeEnricher.enrichTrade(mappedTrade, {
        smartScore: scrapedTrade.smartScore,
      })),
      scrapedTrade,
    );
    if (mappedTrade.proxyWallet && mappedTrade.conditionId) {
      enriched.coordinationSignal = this.coordinationDetector.recordAndCheck(
        mappedTrade.conditionId,
        mappedTrade.proxyWallet,
        mappedTrade.side,
        mappedTrade.usdcSize,
      );
    }
    await this.publishTrade(enriched);
  }

  private async decorateTrade(trade: EnrichedTrade): Promise<EnrichedTrade> {
    if (!this.walletTradeRepo) {
      return trade;
    }

    try {
      const pattern = this.walletTradeRepo.analyzePattern(trade.trade.proxyWallet);
      trade.walletPattern = {
        totalTrades: pattern.totalTrades,
        recentFrequency: pattern.recentFrequency,
        isRepeatTrader: pattern.isRepeatTrader,
        repeatMarkets: pattern.repeatMarkets,
        prefersHighRisk: pattern.prefersHighRisk,
      };
    } catch (error) {
      logger.warn(`Wallet pattern analysis failed for ${trade.trade.proxyWallet}`, error);
    }

    return trade;
  }

  private createScrapedAmountDedupKey(trade: PolymarketTrade): string {
    if (trade.proxyWallet && trade.asset) {
      return createSourceDedupKey(trade);
    }
    return [
      'scraped-market',
      normalizeText(trade.title),
      normalizeText(trade.outcome),
      trade.side,
      String(Math.round(trade.usdcSize)),
      String(Math.round(trade.price * 1000)),
      String(Math.floor(Number(trade.timestamp || 0) / 300)),
    ].join(':');
  }

  private async resolveScrapedMarket(
    trade: PolymarketTrade,
    scrapedTrade: ScrapedChannelTrade,
  ): Promise<PolymarketTrade> {
    const fallbackSlug = slugifyTitle(scrapedTrade.marketQuestion);
    if (scrapedTrade.marketSlug) {
      const slugMatches = await this.gammaApi.findMarkets({
        slug: scrapedTrade.marketSlug,
        limit: 5,
      }).catch((error) => {
        logger.warn(`Gamma market lookup failed for scraped slug ${scrapedTrade.marketSlug}`, error);
        return [] as GammaMarketLookup[];
      });
      const market = slugMatches.find((candidate) => candidate.slug === scrapedTrade.marketSlug) ?? slugMatches[0];
      if (market) {
        const outcomes = parseArray<string>(market.outcomes);
        const matchedOutcomeIndex = outcomes.findIndex(
          (candidate) => normalizeText(candidate) === normalizeText(scrapedTrade.outcome),
        );
        const outcomeIndex = matchedOutcomeIndex >= 0 ? matchedOutcomeIndex : trade.outcomeIndex;
        return {
          ...trade,
          conditionId: market.conditionId,
          asset: market.conditionId,
          title: market.question || scrapedTrade.marketQuestion,
          slug: market.slug || scrapedTrade.marketSlug,
          icon: market.image || market.icon || '',
          eventSlug: market.eventSlug || market.events?.[0]?.slug || scrapedTrade.eventSlug || scrapedTrade.marketSlug,
          outcomeIndex,
          outcome: outcomes[outcomeIndex] || scrapedTrade.outcome,
        };
      }
    }
    const candidates = await this.gammaApi.findMarkets({
      search: scrapedTrade.marketQuestion,
      limit: 10,
    }).catch((error) => {
      logger.warn(`Gamma search failed for scraped trade ${scrapedTrade.messageId}`, error);
      return [] as GammaMarketLookup[];
    });
    const bestMatch = candidates
      .sort((left, right) => this.scoreScrapedMarket(scrapedTrade, right) - this.scoreScrapedMarket(scrapedTrade, left))[0];
    const bestScore = bestMatch ? this.scoreScrapedMarket(scrapedTrade, bestMatch) : 0;
    if (!bestMatch || bestScore < 60) {
      return {
        ...trade,
        title: scrapedTrade.marketQuestion,
        slug: fallbackSlug,
        eventSlug: scrapedTrade.eventSlug || fallbackSlug,
      };
    }

    const outcomes = parseArray<string>(bestMatch.outcomes);
    const matchedOutcomeIndex = outcomes.findIndex((candidate) => normalizeText(candidate) === normalizeText(scrapedTrade.outcome));
    const outcomeIndex = matchedOutcomeIndex >= 0 ? matchedOutcomeIndex : trade.outcomeIndex;
    return {
      ...trade,
      conditionId: bestMatch.conditionId,
      asset: bestMatch.conditionId,
      title: bestMatch.question || scrapedTrade.marketQuestion,
      slug: bestMatch.slug || fallbackSlug,
      icon: bestMatch.image || bestMatch.icon || '',
      eventSlug: bestMatch.eventSlug || bestMatch.events?.[0]?.slug || bestMatch.slug || fallbackSlug,
      outcomeIndex,
      outcome: outcomes[outcomeIndex] || scrapedTrade.outcome,
    };
  }

  private scoreScrapedMarket(scrapedTrade: ScrapedChannelTrade, candidate: GammaMarketLookup): number {
    let score = 0;
    const tradeQuestion = normalizeText(scrapedTrade.marketQuestion);
    const candidateQuestion = normalizeText(candidate.question || '');
    const tradeOutcome = normalizeText(scrapedTrade.outcome);
    const outcomes = parseArray<string>(candidate.outcomes);
    const candidateEndDate = normalizeText(candidate.endDateIso || candidate.endDate || candidate.expirationDate || candidate.closeTime || '');
    const scrapedResolveDate = normalizeText(scrapedTrade.resolveDate || '');

    if (tradeQuestion && candidateQuestion === tradeQuestion) {
      score += 100;
    } else if (
      tradeQuestion
      && candidateQuestion
      && (candidateQuestion.includes(tradeQuestion) || tradeQuestion.includes(candidateQuestion))
    ) {
      score += 50;
    }
    if (tradeOutcome && outcomes.some((outcome) => normalizeText(outcome) === tradeOutcome)) {
      score += 25;
    }
    if (scrapedResolveDate && candidateEndDate && candidateEndDate.includes(scrapedResolveDate)) {
      score += 10;
    }
    return score;
  }

  private applyScrapedMetadata(trade: EnrichedTrade, scrapedTrade: ScrapedChannelTrade): EnrichedTrade {
    const updated = { ...trade };
    updated.trade = {
      ...updated.trade,
      name: scrapedTrade.traderName,
      pseudonym: scrapedTrade.traderName,
      proxyWallet: updated.trade.proxyWallet || scrapedTrade.walletAddress || '',
    };

    if (scrapedTrade.positions !== undefined) {
      updated.traderStats.totalPositionsValue = Math.max(updated.traderStats.totalPositionsValue, scrapedTrade.positions);
      updated.traderStats.portfolioValue = Math.max(updated.traderStats.portfolioValue, scrapedTrade.positions);
    }
    if (scrapedTrade.pnl !== undefined) {
      updated.traderStats.totalRealizedPnl = scrapedTrade.pnl;
    }
    if (scrapedTrade.smartScore !== undefined) {
      updated.smartScore = scrapedTrade.smartScore;
    }
    const winRate = parseWinRateDetails(scrapedTrade.winRate);
    if (winRate) {
      updated.traderStats.winRate = winRate.winRate;
      updated.traderStats.wins = winRate.wins;
      updated.traderStats.losses = winRate.losses;
      updated.traderStats.closedPositions = winRate.wins + winRate.losses;
      updated.traderStats.totalBets = updated.traderStats.livePositions + updated.traderStats.closedPositions;
      updated.traderStats.winRateLabel = `${Math.round(winRate.winRate)}% (${winRate.wins}W-${winRate.losses}L)`;
    } else if (scrapedTrade.winRate) {
      updated.traderStats.winRateLabel = scrapedTrade.winRate;
    }
    if (scrapedTrade.polycopWinRate) {
      const polycopWinRate = parseFloat(scrapedTrade.polycopWinRate);
      if (!Number.isNaN(polycopWinRate) && updated.traderStats.closedPositions < 5) {
        updated.traderStats.winRate = polycopWinRate;
        updated.traderStats.winRateLabel = `${Math.round(polycopWinRate)}% (PolyCop)`;
      }
    }

    const topHolderSplitMatch = scrapedTrade.topHolders?.match(
      /Top Holders:\s*(\d+)(?:\/(\d+))?\s+([A-Za-z]+)\s+[·•]\s+(\d+)(?:\/(\d+))?\s+([A-Za-z]+)/i,
    );
    if (topHolderSplitMatch && updated.holderStats.topHoldersOnSide === 0 && updated.holderStats.oppositeSideHolders === 0) {
      updated.holderStats.topHoldersOnSide = Number(topHolderSplitMatch[1]);
      updated.holderStats.side = topHolderSplitMatch[3] ?? updated.holderStats.side;
      updated.holderStats.oppositeSideHolders = Number(topHolderSplitMatch[4]);
      updated.holderStats.oppositeSide = topHolderSplitMatch[6] ?? updated.holderStats.oppositeSide;
      updated.holderStats.totalTopHolders = Number(topHolderSplitMatch[2] || topHolderSplitMatch[5] || 0)
        || updated.holderStats.topHoldersOnSide + updated.holderStats.oppositeSideHolders;
    }

    const topHolderLegacyMatch = scrapedTrade.topHolders?.match(/(\d+)\/(\d+)\s+Top Holders on\s+([A-Za-z]+)\s+side/i);
    if (topHolderLegacyMatch && updated.holderStats.topHoldersOnSide === 0) {
      updated.holderStats.topHoldersOnSide = Number(topHolderLegacyMatch[1]);
      updated.holderStats.totalTopHolders = Number(topHolderLegacyMatch[2]);
      updated.holderStats.side = topHolderLegacyMatch[3] ?? updated.holderStats.side;
    }

    return updated;
  }
}
