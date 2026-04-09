import { config } from './config';
import Database from 'better-sqlite3';
import { initDatabase } from './db/database';
import { WalletTradeRepo } from './db/wallet-trade-repo';
import { PolygonscanApi } from './api/polygonscan-api';
import { WhaleTracker } from './tracker/whale-tracker';
import { ChannelPoster } from './telegram/channel-poster';
import { logger } from './utils/logger';

let fatalExitTimer: NodeJS.Timeout | null = null;
let database: Database.Database | null = null;

function scheduleFatalExit() {
  if (fatalExitTimer) {
    return;
  }
  fatalExitTimer = setTimeout(() => process.exit(1), 30_000);
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  scheduleFatalExit();
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', err);
  scheduleFatalExit();
});

async function main() {
  logger.info('Starting Polymarket Whale Bot...');

  database = initDatabase();
  const walletTradeRepo = new WalletTradeRepo(database);
  const polygonscanApi = config.polygonscan.enabled
    ? new PolygonscanApi(config.polygonscan.apiKey)
    : undefined;
  const poster = new ChannelPoster(config.telegram);
  const tracker = new WhaleTracker(config, async (enrichedTrade) => {
    try {
      await poster.postAlert(enrichedTrade);
      logger.info(`Posted alert: ${enrichedTrade.trade.title} - $${enrichedTrade.trade.usdcSize}`);
    } catch (error) {
      logger.error('Failed to post alert:', error);
    }
  }, {
    database,
    walletTradeRepo,
    polygonscanApi,
  });

  const sampleTrade = await tracker.runStartupSmokeTest(poster.getCardGenerator(), config.runtime.sampleCardPath);
  await poster.writeSampleOutput(sampleTrade, config.runtime.sampleCaptionPath);
  await poster.launch();
  await tracker.start();

  const shutdown = () => {
    logger.info('Shutting down...');
    tracker.stop();
    poster.stop();
    database?.close();
    database = null;
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Fatal startup error', error);
  if (database) {
    database.close();
    database = null;
  }
  scheduleFatalExit();
});
