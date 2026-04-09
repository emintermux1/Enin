import { HashdiveApi } from '../api/hashdive-api';
import { GammaApi } from '../api/gamma-api';
import { EnrichedTrade, PolymarketTrade } from '../types';
import { logger } from '../utils/logger';
import { CoordinationDetector } from '../classifier/coordination-detector';
import { DedupCache } from './dedup-cache';
import { TradeEnricher } from './trade-enricher';
import { WalletManager } from './wallet-manager';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSourceDedupKey(trade: Pick<PolymarketTrade, 'proxyWallet' | 'asset' | 'timestamp' | 'side' | 'usdcSize'>): string {
  return [
    'source',
    trade.proxyWallet.toLowerCase(),
    trade.asset,
    String(Math.floor(Number(trade.timestamp || 0))),
    trade.side,
    String(Math.round(Number(trade.usdcSize || 0))),
  ].join(':');
}

export interface HashdiveDiscoveryOptions {
  hashdiveApi: HashdiveApi;
  gammaApi: GammaApi;
  walletManager: WalletManager;
  tradeEnricher: TradeEnricher;
  coordinationDetector: CoordinationDetector;
  dedupCache: DedupCache;
  minTradeSize: number;
  pollIntervalMs: number;
  onTrade: (trade: EnrichedTrade) => Promise<void>;
}

export class HashdiveDiscovery {
  private static readonly POLL_TIMEOUT_MS = 45_000;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private readonly startupTimestamp = Math.floor(Date.now() / 1000);
  private lastPollTimestamp = 0;

  constructor(private readonly options: HashdiveDiscoveryOptions) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastPollTimestamp = this.startupTimestamp;
    logger.info(
      `Starting Hashdive discovery polling every ${this.options.pollIntervalMs}ms`,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.pollIntervalMs);
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
      const trades = await Promise.race([
        this.options.hashdiveApi.getLatestWhaleTrades(
          this.options.minTradeSize,
          50,
        ),
        new Promise<[]>(resolve =>
          setTimeout(() => resolve([]), HashdiveDiscovery.POLL_TIMEOUT_MS),
        ),
      ]);
      const newTrades = trades.filter((trade) => {
        const timestamp = Number(trade.timestamp || 0);
        return timestamp > this.lastPollTimestamp;
      });
      logger.info(
        `Hashdive discovery poll returned ${trades.length} whale trades, ${newTrades.length} new`,
      );
      if (trades.length > 0) {
        const maxTimestamp = Math.max(...trades.map(trade => Number(trade.timestamp || 0)));
        if (maxTimestamp > this.lastPollTimestamp) {
          this.lastPollTimestamp = maxTimestamp;
        }
      }
      for (const rawTrade of [...newTrades].sort(
        (left, right) =>
          Number(left.timestamp || 0) - Number(right.timestamp || 0),
      )) {
        await this.processTrade(rawTrade.user_address, rawTrade.asset_id, rawTrade);
      }
    } catch (error) {
      logger.error('Hashdive discovery poll failed', error);
    } finally {
      this.processing = false;
    }
  }

  private async processTrade(
    walletAddress: string,
    assetId: string,
    rawTrade: Awaited<ReturnType<HashdiveApi['getLatestWhaleTrades']>>[number],
  ): Promise<void> {
    const mappedTrade = await this.options.hashdiveApi.mapToPolymarketTrade(rawTrade, {
      gammaApi: this.options.gammaApi,
      trackedWallet: this.options.walletManager.getWallet(walletAddress),
    });
    const price = Number(mappedTrade.price || 0);
    if (
      mappedTrade.usdcSize < this.options.minTradeSize ||
      price < 0.03 ||
      price > 0.93
    ) {
      return;
    }

    const dedupKeys = [
      mappedTrade.transactionHash,
      buildSourceDedupKey(mappedTrade),
      `hashdive:${walletAddress.toLowerCase()}:${assetId}:${mappedTrade.timestamp}`,
    ];
    if (!this.options.dedupCache.addManyIfNew(dedupKeys)) {
      return;
    }

    const enriched = await this.options.tradeEnricher.enrichTrade(mappedTrade);
    enriched.coordinationSignal = this.options.coordinationDetector.recordAndCheck(
      mappedTrade.conditionId,
      mappedTrade.proxyWallet,
      mappedTrade.side,
      mappedTrade.usdcSize,
    );
    await this.options.onTrade(enriched);
    await delay(100);
  }
}

export function createSourceDedupKey(
  trade: Pick<PolymarketTrade, 'proxyWallet' | 'asset' | 'timestamp' | 'side' | 'usdcSize'>,
): string {
  return buildSourceDedupKey(trade);
}
