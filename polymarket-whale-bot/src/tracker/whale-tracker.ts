import { AppConfig, EnrichedTrade, PolymarketTrade } from '../types';
import { DataApi } from '../api/data-api';
import { GammaApi } from '../api/gamma-api';
import { TradeEnricher } from './trade-enricher';
import { WalletManager } from './wallet-manager';
import { DedupCache } from './dedup-cache';
import { logger } from '../utils/logger';
import { CardGenerator } from '../image/card-generator';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WhaleTracker {
  private readonly dataApi: DataApi;
  private readonly gammaApi: GammaApi;
  private readonly walletManager: WalletManager;
  private readonly dedupCache = new DedupCache();
  private readonly tradeEnricher: TradeEnricher;
  private readonly lastSeenTimestamps = new Map<string, number>();
  private running = false;
  private processing = false;
  private timer: NodeJS.Timeout | null = null;
  private cursor = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly onTrade: (trade: EnrichedTrade) => Promise<void>,
  ) {
    this.dataApi = new DataApi(config.api);
    this.gammaApi = new GammaApi(config.api);
    this.walletManager = new WalletManager(this.dataApi, config.tracking);
    this.tradeEnricher = new TradeEnricher(this.dataApi, this.gammaApi, this.walletManager);
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

    const enriched = await this.tradeEnricher.enrichTrade(sampleTrade);
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
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
      .filter((trade) => this.dedupCache.addIfNew(trade.transactionHash))
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of newTrades) {
      const enriched = await this.tradeEnricher.enrichTrade(trade);
      await this.onTrade(enriched);
      await delay(100);
    }
  }
}
