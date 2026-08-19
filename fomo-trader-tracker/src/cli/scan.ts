import { describeConfig } from '../config';
import { getDb } from '../db/database';
import { runDiscovery, runScan } from '../tracker/scanner';

const DEFAULT_BATCH = 25;

/** One-shot discovery plus screening pass, for testing the pipeline. */
async function main(): Promise<void> {
  getDb();

  const batchArg = Number(process.argv[2]);
  const batchSize = Number.isFinite(batchArg) && batchArg > 0 ? batchArg : DEFAULT_BATCH;

  console.log(`config: ${describeConfig()}`);
  console.log(`scanning up to ${batchSize} candidates\n`);

  await runDiscovery();
  const summary = await runScan(batchSize);

  console.log('\nsummary');
  console.log(`  checked:      ${summary.checked}`);
  console.log(`  new traders:  ${summary.qualified}`);
  console.log(`  dropped:      ${summary.dropped}`);
  console.log(`  deferred:     ${summary.deferred}`);
  console.log(`  watchlist:    ${summary.watchlistSize}`);
  console.log(`  candidates:   ${summary.candidates}`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
