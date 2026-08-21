import { config } from '../config';
import { FilterResult, Portfolio, QualifiedTrader, TraderSource, WalletActivity } from '../types';

/**
 * Applies the tracking criteria: enough capital, a memecoin book in the target
 * range, and recent trading. The score is only used for ranking the watchlist
 * when it exceeds the size cap.
 */
export function evaluateTrader(
  portfolio: Portfolio,
  activity: WalletActivity,
  source: TraderSource
): FilterResult {
  const { minPortfolioUsd, minMemecoins, maxMemecoins, minTradesInWindow } = config.filter;
  const wallet = portfolio.wallet;

  if (portfolio.totalUsdValue < minPortfolioUsd) {
    return { wallet, qualified: false, reason: 'below_min_portfolio', trader: null };
  }
  if (portfolio.memecoinCount < minMemecoins) {
    return { wallet, qualified: false, reason: 'too_few_memecoins', trader: null };
  }
  if (portfolio.memecoinCount > maxMemecoins) {
    return { wallet, qualified: false, reason: 'too_many_memecoins', trader: null };
  }
  if (activity.tradeCount < minTradesInWindow) {
    return { wallet, qualified: false, reason: 'inactive', trader: null };
  }

  const trader: QualifiedTrader = {
    wallet,
    source,
    portfolioUsd: portfolio.totalUsdValue,
    cashUsd: portfolio.cashUsdValue,
    memecoinUsd: portfolio.memecoinUsdValue,
    memecoinCount: portfolio.memecoinCount,
    tradeCount: activity.tradeCount,
    lastTradeAt: activity.lastTradeAt,
    score: scoreTrader(portfolio, activity),
    qualifiedAt: Date.now(),
  };

  return { wallet, qualified: true, reason: null, trader };
}

/**
 * Ranks by capital at risk in memecoins and trading cadence, so the watchlist
 * keeps the most active sizeable traders when the cap is hit.
 */
function scoreTrader(portfolio: Portfolio, activity: WalletActivity): number {
  const capitalScore = Math.log10(Math.max(portfolio.totalUsdValue, 1)) * 10;
  const convictionScore =
    portfolio.totalUsdValue > 0 ? (portfolio.memecoinUsdValue / portfolio.totalUsdValue) * 20 : 0;
  const activityScore = Math.min(activity.tradeCount, 100) / 2;
  return Math.round((capitalScore + convictionScore + activityScore) * 100) / 100;
}

export function describeReason(reason: FilterResult['reason']): string {
  switch (reason) {
    case 'below_min_portfolio':
      return `portfolio below $${config.filter.minPortfolioUsd.toLocaleString()}`;
    case 'too_few_memecoins':
      return `fewer than ${config.filter.minMemecoins} memecoins`;
    case 'too_many_memecoins':
      return `more than ${config.filter.maxMemecoins} memecoins`;
    case 'inactive':
      return `fewer than ${config.filter.minTradesInWindow} trades in ${config.filter.activityWindowDays}d`;
    case null:
      return 'qualified';
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled reject reason: ${String(exhaustive)}`);
    }
  }
}
