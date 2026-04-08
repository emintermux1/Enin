import { HolderStats, PolymarketTrade, TraderStats, TraderType, TrackedWallet } from '../types';

export const TRADER_TYPE_META: Record<TraderType, { label: string; emoji: string }> = {
  WHALE: { label: 'WHALE TRADE', emoji: '🐋' },
  INSIDER: { label: 'INSIDER SIGNAL', emoji: '🕵️' },
  TOP_HOLDER: { label: 'TOP HOLDER', emoji: '👑' },
  CONVICTION_BUILD: { label: 'CONVICTION BUILD', emoji: '🔥' },
};

const PRIORITY: TraderType[] = ['INSIDER', 'WHALE', 'TOP_HOLDER', 'CONVICTION_BUILD'];

export interface TraderClassificationInput {
  trade: PolymarketTrade;
  traderStats: TraderStats;
  trackedWallet?: TrackedWallet;
  holderStats: HolderStats;
  recentTradeCount: number;
  convictionBuild: boolean;
}

export function classifyTrader(input: TraderClassificationInput): { traderTypes: TraderType[]; primaryType: TraderType } {
  const traderTypes: TraderType[] = [];
  const extremePrice = input.trade.price < 0.15 || input.trade.price > 0.85;
  const hasHighWinRate = input.traderStats.winRate >= 80 && input.traderStats.closedPositions >= 5;
  const freshHighValueWallet = input.recentTradeCount > 0 && input.recentTradeCount < 20 && input.traderStats.totalPositionsValue >= 100_000;
  const highPrecisionExtremeBuy = input.traderStats.winRate >= 75 && extremePrice;

  if (input.traderStats.portfolioValue > 500_000 || input.trackedWallet?.allTimeTop50 || input.trade.usdcSize > 50_000) {
    traderTypes.push('WHALE');
  }
  if (hasHighWinRate || freshHighValueWallet || highPrecisionExtremeBuy) {
    traderTypes.push('INSIDER');
  }
  if (input.holderStats.traderIsTopHolder) {
    traderTypes.push('TOP_HOLDER');
  }
  if (input.convictionBuild) {
    traderTypes.push('CONVICTION_BUILD');
  }
  if (traderTypes.length === 0) {
    traderTypes.push(input.trade.usdcSize >= 25_000 ? 'WHALE' : 'CONVICTION_BUILD');
  }

  const primaryType = (PRIORITY.find((type) => traderTypes.includes(type)) ?? traderTypes[0]) as TraderType;
  return { traderTypes, primaryType };
}
