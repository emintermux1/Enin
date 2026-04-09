export interface InsiderScore {
  score: number;
  signals: string[];
  isInsider: boolean;
}

export function calculateInsiderScore(params: {
  winRate: number;
  closedPositions: number;
  isFreshWallet: boolean;
  recentTradeCount: number;
  tradePrice: number;
  tradeSize: number;
  portfolioValue: number;
  totalRealizedPnl: number;
  bestWinStreak: number | null;
  preNewsTradeDetected?: boolean;
  historicalPreNewsCount?: number;
  cumulativeInsiderScore?: number;
  eventProximityHours?: number;
}): InsiderScore {
  let score = 0;
  const signals: string[] = [];

  if (params.closedPositions >= 10 && params.winRate >= 90) {
    score += 35;
    signals.push('Elite win rate (90%+, 10+ bets)');
  } else if (params.closedPositions >= 5 && params.winRate >= 80) {
    score += 25;
    signals.push('High win rate (80%+, 5+ bets)');
  } else if (params.closedPositions >= 3 && params.winRate >= 70) {
    score += 15;
    signals.push('Good win rate (70%+)');
  }

  if (params.tradePrice <= 0.15 || params.tradePrice >= 0.85) {
    score += 25;
    signals.push('Extreme price bet');
  } else if (params.tradePrice <= 0.25 || params.tradePrice >= 0.75) {
    score += 10;
    signals.push('Confident price range');
  }

  if (params.isFreshWallet && params.tradeSize >= 25_000) {
    score += 20;
    signals.push('Fresh wallet, large trade');
  } else if (params.isFreshWallet && params.tradeSize >= 10_000) {
    score += 10;
    signals.push('Fresh wallet');
  }

  if (params.bestWinStreak && params.bestWinStreak >= 10) {
    score += 10;
    signals.push(`${params.bestWinStreak} win streak`);
  } else if (params.bestWinStreak && params.bestWinStreak >= 5) {
    score += 5;
    signals.push(`${params.bestWinStreak} win streak`);
  }

  if (params.totalRealizedPnl > 100_000) {
    score += 10;
    signals.push('Highly profitable ($100K+ P&L)');
  } else if (params.totalRealizedPnl > 10_000) {
    score += 5;
    signals.push('Profitable ($10K+ P&L)');
  }

  if (params.preNewsTradeDetected) {
    score += 30;
    signals.push('Traded before news broke');
  }

  if (params.historicalPreNewsCount && params.historicalPreNewsCount >= 3) {
    score += 20;
    signals.push(`${params.historicalPreNewsCount}x pre-news pattern detected`);
  } else if (params.historicalPreNewsCount && params.historicalPreNewsCount >= 1) {
    score += 10;
    signals.push('Prior pre-news trade on record');
  }

  if (params.cumulativeInsiderScore && params.cumulativeInsiderScore >= 50) {
    score += 15;
    signals.push('Known suspected insider wallet');
  } else if (params.cumulativeInsiderScore && params.cumulativeInsiderScore >= 25) {
    score += 8;
    signals.push('Wallet has prior insider signals');
  }

  if (
    params.eventProximityHours !== undefined
    && params.eventProximityHours <= 6
    && (params.tradePrice <= 0.2 || params.tradePrice >= 0.8)
  ) {
    score += 15;
    signals.push(`Trading ${params.eventProximityHours}h before resolution`);
  }

  return {
    score: Math.min(score, 100),
    signals,
    isInsider: score >= 60,
  };
}
