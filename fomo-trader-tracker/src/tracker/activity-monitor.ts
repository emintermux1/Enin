import { alertTrade } from '../alerts/telegram';
import { rpc } from '../chain/solana-rpc';
import { config } from '../config';
import { getWatchlist, markSignatureSeen, recordTrade } from '../db/trader-repo';
import { short } from '../discovery/router-discovery';
import { detectTrades } from './trade-detector';

const SIGNATURES_PER_POLL = 10;

/**
 * Polls watchlist wallets for transactions we have not seen before and alerts
 * on the trades inside them. The first poll of a wallet records its recent
 * history without alerting, so starting the bot does not replay old trades.
 */
export async function pollWatchlistActivity(warmupWallets: Set<string>): Promise<number> {
  const watchlist = getWatchlist(config.monitor.maxWatchlistSize);
  let alerted = 0;

  for (const trader of watchlist) {
    try {
      const signatures = await rpc.getSignaturesForAddress(trader.wallet, SIGNATURES_PER_POLL);
      const isWarmup = !warmupWallets.has(trader.wallet);

      for (const entry of signatures.reverse()) {
        if (entry.err) {
          continue;
        }
        const isNew = markSignatureSeen(trader.wallet, entry.signature);
        if (!isNew || isWarmup) {
          continue;
        }

        const trades = await detectTrades(rpc, trader.wallet, entry.signature);
        for (const trade of trades) {
          recordTrade(trade);
          if (trade.usdValue >= config.monitor.minTradeAlertUsd) {
            await alertTrade(trade);
            alerted += 1;
          }
        }
      }

      warmupWallets.add(trader.wallet);
    } catch (err) {
      console.warn(
        `[monitor] ${short(trader.wallet)} poll failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return alerted;
}
