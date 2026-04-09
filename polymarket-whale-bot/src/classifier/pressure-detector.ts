export interface PressureSignal {
  whalesInMarket: number;
  totalTopHolders: number;
  side: string;
  dominancePercent: number;
  isHighPressure: boolean;
  label: string;
}

export function detectPressure(
  topHoldersOnSide: number,
  totalTopHolders: number,
  side: string,
  whalesInMarket: number,
  tradeSide: 'BUY' | 'SELL',
): PressureSignal {
  const dominance = totalTopHolders > 0 ? (topHoldersOnSide / totalTopHolders) * 100 : 0;
  const isHigh = dominance >= 60 && topHoldersOnSide >= 10;
  const direction = tradeSide === 'BUY' ? 'Buy' : 'Sell';

  return {
    whalesInMarket,
    totalTopHolders,
    side,
    dominancePercent: Math.round(dominance),
    isHighPressure: isHigh,
    label: isHigh ? `⚠️ Strong ${direction} Pressure (${topHoldersOnSide}/${totalTopHolders} top holders)` : '',
  };
}
