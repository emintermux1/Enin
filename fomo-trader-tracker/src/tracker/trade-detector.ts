import { jupiterPrice } from '../chain/jupiter-price';
import { SolanaRpc } from '../chain/solana-rpc';
import { isCashLike, isMajor } from '../chain/token-registry';
import { DetectedTrade, ParsedTransaction, TokenBalanceEntry } from '../types';

/**
 * Derives what a wallet bought or sold by diffing its token balances across a
 * transaction. Cash and majors are ignored so a swap reports the memecoin leg
 * rather than the USDC leg.
 */
export async function detectTrades(
  rpc: SolanaRpc,
  wallet: string,
  signature: string
): Promise<DetectedTrade[]> {
  let tx: ParsedTransaction | null = null;
  try {
    tx = await rpc.getTransaction(signature);
  } catch (err) {
    console.warn(`[trade] ${signature.slice(0, 8)} fetch failed:`, err instanceof Error ? err.message : String(err));
    return [];
  }
  if (!tx || tx.meta?.err) {
    return [];
  }

  const deltas = computeOwnerDeltas(tx, wallet);
  if (deltas.size === 0) {
    return [];
  }

  const interesting = [...deltas.entries()].filter(
    ([mint, delta]) => delta !== 0 && !isCashLike(mint) && !isMajor(mint)
  );
  if (interesting.length === 0) {
    return [];
  }

  const { prices } = await jupiterPrice.getPrices(interesting.map(([mint]) => mint));
  const blockTime = tx.blockTime ?? Math.floor(Date.now() / 1000);

  const trades: DetectedTrade[] = [];
  for (const [mint, delta] of interesting) {
    const price = prices.get(mint);
    if (!price) {
      continue;
    }
    trades.push({
      wallet,
      signature,
      mint,
      side: delta > 0 ? 'buy' : 'sell',
      uiAmount: Math.abs(delta),
      usdValue: Math.abs(delta) * price.usdPrice,
      blockTime,
    });
  }

  return trades;
}

function computeOwnerDeltas(tx: ParsedTransaction, wallet: string): Map<string, number> {
  const before = sumByMint(tx.meta?.preTokenBalances ?? [], wallet);
  const after = sumByMint(tx.meta?.postTokenBalances ?? [], wallet);

  const deltas = new Map<string, number>();
  for (const mint of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(mint) ?? 0) - (before.get(mint) ?? 0);
    if (delta !== 0) {
      deltas.set(mint, delta);
    }
  }

  return deltas;
}

function sumByMint(entries: TokenBalanceEntry[], wallet: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.owner !== wallet) {
      continue;
    }
    const amount = entry.uiTokenAmount.uiAmount ?? 0;
    totals.set(entry.mint, (totals.get(entry.mint) ?? 0) + amount);
  }
  return totals;
}
