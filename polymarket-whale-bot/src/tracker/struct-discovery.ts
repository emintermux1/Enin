import { GammaApi, GammaMarketLookup } from '../api/gamma-api';
import { StructApi, StructWhaleAlert } from '../api/struct-api';
import { CoordinationDetector } from '../classifier/coordination-detector';
import { EnrichedTrade, PolymarketTrade } from '../types';
import { logger } from '../utils/logger';
import { DedupCache } from './dedup-cache';
import { createSourceDedupKey } from './hashdive-discovery';
import { TradeEnricher } from './trade-enricher';
import { WalletManager } from './wallet-manager';

interface ResolvedStructMarket {
  conditionId: string;
  question: string;
  slug: string;
  image: string;
  eventSlug: string;
  outcomes?: string[];
}

export interface StructDiscoveryOptions {
  apiKey: string;
  gammaApi: GammaApi;
  walletManager: WalletManager;
  tradeEnricher: TradeEnricher;
  coordinationDetector: CoordinationDetector;
  dedupCache: DedupCache;
  minTradeSize: number;
  onTrade: (trade: EnrichedTrade) => Promise<void>;
}

export class StructDiscovery {
  private structApi: StructApi | null = null;

  constructor(private readonly options: StructDiscoveryOptions) {}

  async start(): Promise<void> {
    if (this.structApi) {
      return;
    }

    this.structApi = new StructApi({
      apiKey: this.options.apiKey,
      onWhaleAlert: async (alert) => {
        try {
          await this.processAlert(alert);
        } catch (error) {
          logger.error('Struct alert processing failed', error);
        }
      },
      onError: (error) => {
        logger.warn('Struct WebSocket error in discovery', error);
      },
    });

    await this.structApi.start();
    logger.info('Struct discovery started');
  }

  stop(): void {
    this.structApi?.stop();
    this.structApi = null;
  }

  private async processAlert(alert: StructWhaleAlert): Promise<void> {
    const data = alert.data;
    const wallet = String(data.wallet || data.user_address || '').toLowerCase();
    const amount = Number(data.amount || 0);
    const price = Number(data.price || 0);

    if (!wallet || amount < this.options.minTradeSize) {
      return;
    }
    if (price < 0.03 || price > 0.93) {
      return;
    }

    const timestamp = Number(data.timestamp || Math.floor(Date.now() / 1000));
    const mappedTrade = await this.mapToPolymarketTrade(data, wallet, timestamp);
    const dedupKeys = [
      mappedTrade.transactionHash,
      createSourceDedupKey(mappedTrade),
      `struct:${wallet}:${mappedTrade.conditionId || mappedTrade.slug}:${timestamp}`,
    ];
    if (!this.options.dedupCache.addManyIfNew(dedupKeys)) {
      return;
    }

    const enriched = await this.options.tradeEnricher.enrichTrade(mappedTrade);
    enriched.coordinationSignal = this.options.coordinationDetector.recordAndCheck(
      mappedTrade.conditionId,
      wallet,
      mappedTrade.side,
      mappedTrade.usdcSize,
    );

    await this.options.onTrade(enriched);
  }

  private async mapToPolymarketTrade(
    data: StructWhaleAlert['data'],
    wallet: string,
    timestamp: number,
  ): Promise<PolymarketTrade> {
    const rawConditionId = String(data.condition_id || data.market_id || '');
    const rawSlug = String(data.market_slug || '');
    const rawTitle = String(data.market_title || '');
    const resolvedMarket = await this.resolveMarket(rawConditionId, rawSlug, rawTitle);
    const conditionId = resolvedMarket?.conditionId || rawConditionId;
    const fallbackSlug = resolvedMarket?.slug || rawSlug || `struct-${conditionId || timestamp}`;
    const trackedWallet = this.options.walletManager.getWallet(wallet);
    const shortWallet = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    const side = String(data.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const outcome = this.resolveOutcome(data, side, resolvedMarket);
    const outcomeIndex = this.resolveOutcomeIndex(data, outcome);

    return {
      proxyWallet: wallet,
      timestamp,
      conditionId,
      type: 'TRADE',
      size: Number(data.amount || 0),
      usdcSize: Number(data.amount || 0),
      transactionHash: `struct-${wallet}-${conditionId || fallbackSlug}-${timestamp}`,
      price: Number(data.price || 0),
      asset: conditionId || fallbackSlug,
      side,
      outcomeIndex,
      title: resolvedMarket?.question || rawTitle || fallbackSlug,
      slug: fallbackSlug,
      icon: resolvedMarket?.image || '',
      eventSlug: resolvedMarket?.eventSlug || fallbackSlug,
      outcome,
      name: trackedWallet?.userName || shortWallet,
      pseudonym: trackedWallet?.xUsername || shortWallet,
      bio: '',
      profileImage: trackedWallet?.profileImage || '',
    };
  }

  private async resolveMarket(
    conditionId: string,
    slug: string,
    title: string,
  ): Promise<ResolvedStructMarket | null> {
    if (conditionId) {
      const markets = await this.options.gammaApi.findMarkets({ conditionId, limit: 1 }).catch(() => []);
      if (markets[0]) {
        return this.mapLookupMarket(markets[0]);
      }
    }

    if (slug) {
      const markets = await this.options.gammaApi.findMarkets({ slug, limit: 1 }).catch(() => []);
      if (markets[0]) {
        return this.mapLookupMarket(markets[0]);
      }
    }

    if (title) {
      const markets = await this.options.gammaApi.findMarkets({ search: title, limit: 5 }).catch(() => []);
      if (markets[0]) {
        return this.mapLookupMarket(markets[0]);
      }
    }

    return null;
  }

  private mapLookupMarket(market: GammaMarketLookup): ResolvedStructMarket {
    return {
      conditionId: market.conditionId,
      question: market.question,
      slug: market.slug,
      image: market.image || market.icon || '',
      eventSlug: market.eventSlug || market.events?.[0]?.slug || market.slug,
      outcomes: this.parseOutcomeArray(market.outcomes),
    };
  }

  private parseOutcomeArray(outcomes: GammaMarketLookup['outcomes']): string[] {
    if (Array.isArray(outcomes)) {
      return outcomes.map((value) => String(value));
    }
    if (!outcomes) {
      return [];
    }
    try {
      const parsed = JSON.parse(outcomes) as string[];
      return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
    } catch {
      return [];
    }
  }

  private resolveOutcome(
    data: StructWhaleAlert['data'],
    side: PolymarketTrade['side'],
    market: ResolvedStructMarket | null,
  ): string {
    const explicitOutcome = String(
      data.outcome
      || data.market_outcome
      || data.token_name
      || data.token_label
      || '',
    ).trim();
    if (explicitOutcome) {
      return explicitOutcome;
    }

    if (typeof data.outcome_index === 'number' && market?.outcomes?.[data.outcome_index]) {
      return market.outcomes[data.outcome_index] || '';
    }

    if (typeof data.outcomeIndex === 'number' && market?.outcomes?.[data.outcomeIndex]) {
      return market.outcomes[data.outcomeIndex] || '';
    }

    if (side === 'SELL' && market?.outcomes?.[1]) {
      return market.outcomes[1];
    }

    return market?.outcomes?.[0] || '';
  }

  private resolveOutcomeIndex(
    data: StructWhaleAlert['data'],
    outcome: string,
  ): number {
    if (typeof data.outcome_index === 'number') {
      return data.outcome_index;
    }
    if (typeof data.outcomeIndex === 'number') {
      return data.outcomeIndex;
    }
    return outcome.toLowerCase().includes('no') ? 1 : 0;
  }
}
