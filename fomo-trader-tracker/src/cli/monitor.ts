import { getDb } from '../db/database';
import { getWatchlist } from '../db/trader-repo';
import { config } from '../config';
import { pollWatchlistActivity } from '../tracker/activity-monitor';

/**
 * Single polling pass over the watchlist, for cron-style operation.
 *
 * Pass --warm to only record current history without alerting, which is what
 * you want the first time so old trades are not replayed.
 */
async function main(): Promise<void> {
  getDb();

  const warmOnly = process.argv.includes('--warm');
  const watchlist = getWatchlist(config.monitor.maxWatchlistSize);

  if (watchlist.length === 0) {
    console.log('Watchlist is empty. Run `npm run scan` first.');
    return;
  }

  console.log(`polling ${watchlist.length} wallet(s)${warmOnly ? ' (warm-up only)' : ''}`);

  // An empty set means every wallet is treated as needing warm-up, so the first
  // pass records history silently.
  const warmed = new Set<string>();
  if (!warmOnly) {
    for (const trader of watchlist) {
      warmed.add(trader.wallet);
    }
  }

  const alerted = await pollWatchlistActivity(warmed);
  console.log(`done: ${alerted} alert(s) sent`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
