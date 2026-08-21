import { config } from '../config';
import { getDb } from '../db/database';
import { countTraders, getWatchlist } from '../db/trader-repo';

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

function ago(timestamp: number | null): string {
  if (timestamp === null) {
    return 'unknown';
  }
  const hours = (Date.now() / 1000 - timestamp) / 3600;
  if (hours < 1) {
    return `${Math.round(hours * 60)}m ago`;
  }
  if (hours < 48) {
    return `${Math.round(hours)}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

/** Prints the current watchlist as a follow list. */
function main(): void {
  getDb();

  const limitArg = Number(process.argv[2]);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : config.monitor.maxWatchlistSize;
  const watchlist = getWatchlist(limit);
  const counts = countTraders();

  if (watchlist.length === 0) {
    console.log('Watchlist is empty. Run `npm run scan` first.');
    return;
  }

  console.log(
    `${'#'.padStart(4)}  ${'wallet'.padEnd(46)} ${'portfolio'.padStart(11)} ${'memes'.padStart(6)} ` +
      `${'trades'.padStart(7)} ${'last'.padStart(9)}  score`
  );

  watchlist.forEach((trader, index) => {
    console.log(
      `${String(index + 1).padStart(4)}  ${trader.wallet.padEnd(46)} ${usd(trader.portfolioUsd).padStart(11)} ` +
        `${String(trader.memecoinCount).padStart(6)} ${String(trader.tradeCount).padStart(7)} ` +
        `${ago(trader.lastTradeAt).padStart(9)}  ${trader.score}`
    );
  });

  console.log(`\n${watchlist.length} shown, ${counts.active} active, ${counts.candidates} candidates screened`);
}

main();
