import { HolderStats, PolymarketTrade, TraderStats, TraderType, TrackedWallet } from '../types';

export const TRADER_TYPE_META: Record<TraderType, { label: string; emoji: string }> = {
  WHALE: { label: 'Whale Trade', emoji: '🐋' },
  INSIDER: { label: 'Insider Spotted', emoji: '🕵️' },
  TOP_HOLDER: { label: 'Top Holder', emoji: '👑' },
  CONVICTION_BUILD: { label: 'Conviction Build', emoji: '🔥' },
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
  const isWhale =
    input.traderStats.portfolioValue > 500_000 ||
    Boolean(input.trackedWallet?.allTimeTop50) ||
    input.trade.usdcSize > 50_000;

  if (isWhale) {
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

  let primaryType: TraderType;
  if (isWhale && traderTypes.includes('INSIDER')) {
    if (input.trade.usdcSize > 50_000 || input.traderStats.portfolioValue > 1_000_000) {
      primaryType = 'WHALE';
    } else if (input.traderStats.winRate >= 90) {
      primaryType = 'INSIDER';
    } else {
      const hash = input.trade.transactionHash || '';
      const lastChar = hash.charAt(hash.length - 1) || '0';
      const hashValue = Number.parseInt(lastChar, 16);
      primaryType = Number.isNaN(hashValue) || hashValue % 2 === 0 ? 'WHALE' : 'INSIDER';
    }
  } else {
    primaryType = (PRIORITY.find((type) => traderTypes.includes(type)) ?? traderTypes[0]) as TraderType;
  }

  return { traderTypes, primaryType };
}
