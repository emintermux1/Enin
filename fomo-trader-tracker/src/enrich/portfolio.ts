import { jupiterPrice } from '../chain/jupiter-price';
import { SolanaRpc, WRAPPED_SOL_MINT } from '../chain/solana-rpc';
import { classifyToken, positionFloorFor } from '../chain/token-registry';
import { ClassifiedHolding, Portfolio } from '../types';

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Builds a priced, classified snapshot of what a wallet holds. Native SOL is
 * folded in as a wrapped-SOL holding so it counts toward portfolio value.
 *
 * Classification runs after totals are known, because whether a position counts
 * as a real memecoin holding depends on its share of the portfolio.
 */
export async function buildPortfolio(rpc: SolanaRpc, wallet: string): Promise<Portfolio> {
  const [lamports, tokenAccounts] = await Promise.all([
    rpc.getSolBalanceLamports(wallet),
    rpc.getTokenHoldings(wallet),
  ]);

  const nativeSol = lamports / LAMPORTS_PER_SOL;

  const merged = new Map<string, { uiAmount: number; decimals: number }>();
  for (const entry of tokenAccounts) {
    const existing = merged.get(entry.mint);
    merged.set(entry.mint, {
      uiAmount: (existing?.uiAmount ?? 0) + entry.uiAmount,
      decimals: entry.decimals,
    });
  }
  if (nativeSol > 0) {
    const existing = merged.get(WRAPPED_SOL_MINT);
    merged.set(WRAPPED_SOL_MINT, {
      uiAmount: (existing?.uiAmount ?? 0) + nativeSol,
      decimals: 9,
    });
  }

  const mints = [...merged.keys()];
  const { prices, skipped } = await jupiterPrice.getPrices(mints);

  const valued: Array<{ mint: string; uiAmount: number; decimals: number; usdValue: number }> = [];
  let totalUsdValue = 0;

  for (const [mint, amount] of merged) {
    const price = prices.get(mint);
    const usdValue = price ? amount.uiAmount * price.usdPrice : 0;
    totalUsdValue += usdValue;
    valued.push({ mint, uiAmount: amount.uiAmount, decimals: amount.decimals, usdValue });
  }

  const positionFloorUsd = positionFloorFor(totalUsdValue);

  const holdings: ClassifiedHolding[] = [];
  let cashUsdValue = 0;
  let memecoinUsdValue = 0;
  let solUsdValue = 0;
  let memecoinCount = 0;

  for (const entry of valued) {
    const tokenClass = classifyToken(entry.mint, entry.usdValue, prices.get(entry.mint), positionFloorUsd);
    holdings.push({ ...entry, tokenClass });

    switch (tokenClass) {
      case 'stable':
        cashUsdValue += entry.usdValue;
        break;
      case 'major':
        if (entry.mint === WRAPPED_SOL_MINT) {
          solUsdValue += entry.usdValue;
        }
        break;
      case 'memecoin':
        memecoinUsdValue += entry.usdValue;
        memecoinCount += 1;
        break;
      case 'dust':
      case 'unpriced':
        break;
      default: {
        const exhaustive: never = tokenClass;
        throw new Error(`Unhandled token class: ${String(exhaustive)}`);
      }
    }
  }

  holdings.sort((a, b) => b.usdValue - a.usdValue);

  return {
    wallet,
    solUsdValue,
    cashUsdValue,
    memecoinUsdValue,
    totalUsdValue,
    memecoinCount,
    positionFloorUsd,
    pricingComplete: skipped === 0,
    mintCount: mints.length,
    holdings,
    fetchedAt: Date.now(),
  };
}
