import { rpc } from '../chain/solana-rpc';
import { config } from '../config';
import { getDb } from '../db/database';
import { measureActivity } from '../enrich/activity';
import { buildPortfolio } from '../enrich/portfolio';
import { describeReason, evaluateTrader } from '../filter/trader-filter';

function usd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * Prints one wallet's priced holdings and how the filter judges it. Useful for
 * tuning DUST_THRESHOLD_USD and MIN_POSITION_SHARE against real wallets.
 */
async function main(): Promise<void> {
  const wallet = process.argv[2];
  if (!wallet) {
    console.error('Usage: npx tsx src/cli/inspect.ts <wallet>');
    process.exit(1);
  }

  getDb();

  const portfolio = await buildPortfolio(rpc, wallet);
  const activity = await measureActivity(rpc, wallet);
  const result = evaluateTrader(portfolio, activity, 'manual');

  const label = (text: string): string => `  ${text.padEnd(16)}`;

  console.log(`\nwallet ${wallet}`);
  console.log(`${label('total:')}${usd(portfolio.totalUsdValue)}`);
  console.log(`${label('cash:')}${usd(portfolio.cashUsdValue)}`);
  console.log(`${label('sol:')}${usd(portfolio.solUsdValue)}`);
  console.log(
    `${label('memecoins:')}${usd(portfolio.memecoinUsdValue)} across ${portfolio.memecoinCount} positions`
  );
  console.log(`${label('position floor:')}${usd(portfolio.positionFloorUsd)}`);
  console.log(
    `${label('token accounts:')}${portfolio.mintCount} (pricing complete: ${portfolio.pricingComplete})`
  );
  console.log(`${label(`trades/${config.filter.activityWindowDays}d:`)}${activity.tradeCount}`);
  console.log(`${label('verdict:')}${result.qualified ? 'QUALIFIED' : describeReason(result.reason)}`);

  const counted = portfolio.holdings.filter((holding) => holding.tokenClass === 'memecoin');
  console.log(`\ncounted memecoin positions (${counted.length}):`);
  for (const holding of counted) {
    console.log(`  ${holding.mint.padEnd(46)} ${usd(holding.usdValue).padStart(14)}`);
  }

  const nearMiss = portfolio.holdings
    .filter((holding) => holding.tokenClass === 'dust' && holding.usdValue > 0)
    .slice(0, 10);
  if (nearMiss.length > 0) {
    console.log(`\nbelow the floor (top ${nearMiss.length} of the excluded tail):`);
    for (const holding of nearMiss) {
      console.log(`  ${holding.mint.padEnd(46)} ${usd(holding.usdValue).padStart(14)}`);
    }
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
