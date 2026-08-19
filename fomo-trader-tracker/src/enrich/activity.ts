import { SolanaRpc } from '../chain/solana-rpc';
import { config } from '../config';
import { WalletActivity } from '../types';

const SECONDS_PER_DAY = 86_400;

/**
 * Counts successful transactions inside the activity window. Failed
 * transactions are ignored so a wallet spamming reverted swaps does not read
 * as active.
 */
export async function measureActivity(rpc: SolanaRpc, wallet: string): Promise<WalletActivity> {
  const windowDays = config.filter.activityWindowDays;
  const cutoff = Math.floor(Date.now() / 1000) - windowDays * SECONDS_PER_DAY;

  const signatures = await rpc.getSignaturesPaged(wallet, 1_000);

  let tradeCount = 0;
  let lastTradeAt: number | null = null;

  for (const entry of signatures) {
    if (entry.err) {
      continue;
    }
    if (entry.blockTime === null) {
      continue;
    }
    if (lastTradeAt === null || entry.blockTime > lastTradeAt) {
      lastTradeAt = entry.blockTime;
    }
    if (entry.blockTime >= cutoff) {
      tradeCount += 1;
    }
  }

  return { wallet, tradeCount, lastTradeAt, windowDays };
}
