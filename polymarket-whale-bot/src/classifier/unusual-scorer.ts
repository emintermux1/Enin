export interface UnusualScore {
  score: number;
  signals: string[];
  isUnusual: boolean;
}

export function calculateUnusualScore(params: {
  tradeSize: number;
  marketVolume: number;
  marketLiquidity: number;
  tradePrice: number;
  portfolioValue: number;
  isFreshWallet: boolean;
  winRate: number;
  closedPositions: number;
}): UnusualScore {
  let score = 0;
  const signals: string[] = [];

  if (params.marketVolume > 0) {
    const volumeRatio = params.tradeSize / params.marketVolume;
    if (volumeRatio > 0.1) {
      score += 30;
      signals.push(`Trade is ${(volumeRatio * 100).toFixed(1)}% of market volume`);
    } else if (volumeRatio > 0.05) {
      score += 20;
      signals.push(`Trade is ${(volumeRatio * 100).toFixed(1)}% of market volume`);
    } else if (volumeRatio > 0.02) {
      score += 10;
      signals.push('Significant market share');
    }
  }

  if (params.marketLiquidity > 0 && params.tradeSize > params.marketLiquidity * 0.5) {
    score += 20;
    signals.push('Trade exceeds 50% of liquidity');
  } else if (params.marketLiquidity > 0 && params.tradeSize > params.marketLiquidity * 0.2) {
    score += 10;
    signals.push('Trade exceeds 20% of liquidity');
  }

  if (params.tradePrice <= 0.15 && params.tradeSize >= 25_000) {
    score += 25;
    signals.push('Large bet at very low odds');
  } else if (params.tradePrice >= 0.85 && params.tradeSize >= 50_000) {
    score += 20;
    signals.push('Massive position at high certainty');
  }

  if (params.portfolioValue > 0 && params.tradeSize / params.portfolioValue > 0.5) {
    score += 15;
    signals.push('Over 50% portfolio in single trade');
  }

  if (params.isFreshWallet) {
    score += 10;
    signals.push('Fresh wallet');
  }

  return {
    score: Math.min(score, 100),
    signals,
    isUnusual: score >= 50,
  };
}
