import { config } from './config';
import { WhaleTracker } from './tracker/whale-tracker';
import { ChannelPoster } from './telegram/channel-poster';
import { logger } from './utils/logger';

async function main() {
  logger.info('Starting Polymarket Whale Bot...');

  const poster = new ChannelPoster(config.telegram);
  const tracker = new WhaleTracker(config, async (enrichedTrade) => {
    try {
      await poster.postAlert(enrichedTrade);
      logger.info(`Posted alert: ${enrichedTrade.trade.title} - $${enrichedTrade.trade.usdcSize}`);
    } catch (error) {
      logger.error('Failed to post alert:', error);
    }
  });

  const sampleTrade = await tracker.runStartupSmokeTest(poster.getCardGenerator(), {
    compact: config.runtime.sampleCompactCardPath,
    premium: config.runtime.samplePosterCardPath,
  });
  await poster.writeSampleOutput(sampleTrade, config.runtime.sampleAlertPath);
  await poster.launch();
  await tracker.start();

  const shutdown = () => {
    logger.info('Shutting down...');
    tracker.stop();
    poster.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Fatal startup error', error);
  process.exit(1);
});
