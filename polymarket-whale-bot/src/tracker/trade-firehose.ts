import { CoordinationDetector } from '../classifier/coordination-detector';
import { DataApi } from '../api/data-api';
import { EnrichedTrade, PolymarketTrade } from '../types';
import { logger } from '../utils/logger';
import { DedupCache } from './dedup-cache';
import { PriceHistory } from './price-history';
import { TradeEnricher } from './trade-enricher';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TradeFirehoseOptions {
  dataApi: DataApi;
  tradeEnricher: TradeEnricher;
  coordinationDetector: CoordinationDetector;
  dedupCache: DedupCache;
  priceHistory?: PriceHistory;
  minTradeSize: number;
  pollIntervalMs: number;
  onTrade: (trade: EnrichedTrade) => Promise<void>;
}

export class TradeFirehose {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private lastSeenTimestamp = 0;

  constructor(private readonly options: TradeFirehoseOptions) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastSeenTimestamp = Math.floor(Date.now() / 1000);
    logger.info(`Starting trade firehose polling every ${this.options.pollIntervalMs}ms`);
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.pollIntervalMs);
    setTimeout(() => {
      void this.tick();
    }, 2_000);
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
      const allTrades = await this.options.dataApi.getRecentTrades(200);

      if (this.options.priceHistory) {
        for (const trade of allTrades) {
          this.options.priceHistory.record(trade.conditionId || trade.slug, trade.price);
        }
      }

      const bigTrades = allTrades
        .filter((trade) => Number(trade.usdcSize || trade.size || 0) >= this.options.minTradeSize)
        .filter((trade) => {
          const price = Number(trade.price || 0);
          return price >= 0.03 && price <= 0.93;
        })
        .filter((trade) => Number(trade.timestamp || 0) > this.lastSeenTimestamp)
        .filter((trade) => {
          const sourceKey = [
            'firehose',
            trade.proxyWallet.toLowerCase(),
            trade.asset,
            String(Math.floor(Number(trade.timestamp || 0))),
            trade.side,
            String(Math.round(Number(trade.usdcSize || trade.size || 0))),
          ].join(':');
          return this.options.dedupCache.addManyIfNew([
            trade.transactionHash,
            sourceKey,
          ]);
        })
        .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));

      if (allTrades.length > 0) {
        const maxTimestamp = Math.max(...allTrades.map((trade) => Number(trade.timestamp || 0)));
        if (maxTimestamp > this.lastSeenTimestamp) {
          this.lastSeenTimestamp = maxTimestamp;
        }
      }

      if (bigTrades.length > 0) {
        logger.info(`Firehose detected ${bigTrades.length} whale trade(s) from ${allTrades.length} total`);
      }

      for (const trade of bigTrades) {
        try {
          if (!trade.usdcSize && trade.size) {
            trade.usdcSize = trade.size;
          }

          const enriched = await this.options.tradeEnricher.enrichTrade(trade);
          enriched.coordinationSignal = this.options.coordinationDetector.recordAndCheck(
            trade.conditionId,
            trade.proxyWallet,
            trade.side,
            trade.usdcSize,
          );
          await this.options.onTrade(enriched);
          await delay(200);
        } catch (error) {
          logger.error(`Firehose trade processing failed for ${trade.transactionHash}`, error);
        }
      }
    } catch (error) {
      logger.warn('Firehose poll failed', error);
    } finally {
      this.processing = false;
    }
  }
}
