import { AppConfig, EnrichedTrade, PolymarketTrade } from '../types';
import Database from 'better-sqlite3';
import { DataApi } from '../api/data-api';
import { GammaApi } from '../api/gamma-api';
import { HashdiveApi } from '../api/hashdive-api';
import { PolygonscanApi } from '../api/polygonscan-api';
import { WalletTradeRepo } from '../db/wallet-trade-repo';
import { TradeEnricher } from './trade-enricher';
import { WalletManager } from './wallet-manager';
import { DedupCache } from './dedup-cache';
import { logger } from '../utils/logger';
import { CardGenerator } from '../image/card-generator';
import { createSourceDedupKey, HashdiveDiscovery } from './hashdive-discovery';
import { NewsCorrelator } from '../classifier/news-correlator';
import { CoordinationDetector } from '../classifier/coordination-detector';
import { PriceHistory } from './price-history';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WhaleTrackerOptions {
  database?: Database.Database;
  walletTradeRepo?: WalletTradeRepo;
  polygonscanApi?: PolygonscanApi;
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
      options.newsCorrelator,
      this.priceHistory,
    );
    this.coordinationDetector = new CoordinationDetector();
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
    await this.hashdiveDiscovery?.start();
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.hashdiveDiscovery?.stop();
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
}
