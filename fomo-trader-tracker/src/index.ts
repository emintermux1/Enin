import { alertCycleSummary } from './alerts/telegram';
import { config, describeConfig } from './config';
import { getDb } from './db/database';
import { countFomoMints } from './db/fomo-mint-repo';
import { pollWatchlistActivity } from './tracker/activity-monitor';
import { runDiscovery, runScan } from './tracker/scanner';

const SCAN_BATCH_SIZE = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  getDb();

  console.log('fomo trader tracker starting');
  console.log(`config: ${describeConfig()}`);
  console.log(`rpc: ${config.solana.rpcUrls.join(', ')}`);
  console.log(`telegram: ${config.telegram.enabled ? 'enabled' : 'dry-run (logs only)'}`);

  const hasStartingPoint =
    config.discovery.routerAccounts.length > 0 ||
    config.discovery.seedWallets.length > 0 ||
    config.discovery.manualWallets.length > 0 ||
    config.discovery.seedMints.length > 0 ||
    countFomoMints().total > 0;

  if (!hasStartingPoint) {
    console.error(
      'Nothing to track. Set any one of:\n' +
        '  FOMO_SEED_MINTS      - a fomo-launched token mint (ends in "fomo"); holders get crawled\n' +
        '  FOMO_SEED_WALLETS    - known fomo wallets; router accounts are derived from them\n' +
        '  FOMO_ROUTER_ACCOUNTS - fomo router / sponsor / fee accounts, if you already know them\n' +
        '  FOMO_MANUAL_WALLETS  - a fixed wallet list\n' +
        'See README.'
    );
    process.exit(1);
  }

  const warmupWallets = new Set<string>();
  let lastDiscoveryAt = 0;
  let running = true;

  const stop = (): void => {
    running = false;
    console.log('shutting down after current cycle');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (running) {
    const cycleStart = Date.now();

    try {
      if (cycleStart - lastDiscoveryAt >= config.monitor.discoveryIntervalMs) {
        await runDiscovery();
        lastDiscoveryAt = cycleStart;
      }

      const summary = await runScan(SCAN_BATCH_SIZE);
      console.log(
        `[cycle] checked ${summary.checked}, new ${summary.qualified}, dropped ${summary.dropped}, ` +
          `deferred ${summary.deferred}, watchlist ${summary.watchlistSize}/${summary.candidates}`
      );

      if (summary.qualified > 0) {
        await alertCycleSummary(summary);
      }

      const alerted = await pollWatchlistActivity(warmupWallets);
      if (alerted > 0) {
        console.log(`[cycle] ${alerted} trade alerts sent`);
      }
    } catch (err) {
      console.error('[cycle] failed:', err instanceof Error ? err.message : String(err));
    }

    if (!running) {
      break;
    }
    const elapsed = Date.now() - cycleStart;
    const wait = Math.max(config.monitor.activityPollIntervalMs - elapsed, 5_000);
    await sleep(wait);
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
