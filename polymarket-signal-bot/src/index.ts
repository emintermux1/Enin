import { config } from './config';
import Database from 'better-sqlite3';
import { initDatabase } from './db/database';
import { WalletTradeRepo } from './db/wallet-trade-repo';
import { InsiderTracker } from './db/insider-tracker';
import { TraderPerformanceRepo } from './db/trader-performance-repo';
import { DataApi } from './api/data-api';
import { GammaApi } from './api/gamma-api';
import { PolynterApi } from './api/polynter-api';
import { PolygonscanApi } from './api/polygonscan-api';
import { NewsApi } from './api/news-api';
import { NewsCorrelator } from './classifier/news-correlator';
import { WhaleTracker } from './tracker/whale-tracker';
import { PriceHistory } from './tracker/price-history';
import { ResolutionChecker } from './tracker/resolution-checker';
import { DailyLeaderboard } from './tracker/daily-leaderboard';
import { MarketHeatmap } from './tracker/market-heatmap';
import { ChannelPoster } from './telegram/channel-poster';
import { RuntimeConfigManager } from './admin/runtime-config';
import { AdminPanel } from './admin/admin-panel';
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
  const startTime = Date.now();
  let polynterRefreshTimer: NodeJS.Timeout | null = null;
  const walletTradeRepo = new WalletTradeRepo(database);
  const insiderTracker = new InsiderTracker(database);
  const traderPerformanceRepo = new TraderPerformanceRepo(database);
  const gammaApi = new GammaApi(config.api);
  const runtimeConfig = new RuntimeConfigManager({
    minTradeSize: config.tracking.minTradeSize,
    maxAlertsPerWalletPerMarket: config.tracking.maxAlertsPerWalletPerMarket,
    referralUrl: config.telegram.referralUrl,
    referralButtonText: config.telegram.referralButtonText,
    firehoseEnabled: true,
    hashdiveEnabled: Boolean(config.api.hashdiveApiKey),
    structEnabled: config.struct.enabled,
    scraperEnabled: config.scraping.enabled,
    polynterEnabled: config.polynter.enabled,
    paused: false,
  });
  const polynterApi = new PolynterApi();
  const polygonscanApi = config.polygonscan.enabled
    ? new PolygonscanApi(config.polygonscan.apiKey)
    : undefined;
  const newsCorrelator = new NewsCorrelator(new NewsApi());
  const priceHistory = new PriceHistory();
  const poster = new ChannelPoster(config.telegram, runtimeConfig);
  const syncPolynterRefresh = () => {
    if (polynterRefreshTimer) {
      clearInterval(polynterRefreshTimer);
      polynterRefreshTimer = null;
    }

    if (!runtimeConfig.get('polynterEnabled')) {
      return;
    }

    polynterApi.refreshAllMarkets().catch((error) => {
      logger.warn('Polynter initial refresh failed', error);
    });
    polynterRefreshTimer = setInterval(() => {
      polynterApi.refreshAllMarkets().catch((error) => {
        logger.warn('Polynter refresh failed', error);
      });
    }, 30 * 60 * 1000);
  };
  syncPolynterRefresh();
  runtimeConfig.on('change', (key) => {
    if (key === 'polynterEnabled') {
      syncPolynterRefresh();
    }
  });
  const adminPanel = new AdminPanel(poster.getBot(), runtimeConfig, {
    adminUserId: config.admin.userId,
    database,
    startTime,
    channelId: config.telegram.channelId,
    hasApiKeys: {
      hashdive: Boolean(config.api.hashdiveApiKey),
      struct: Boolean(config.struct.apiKey),
      polygonscan: Boolean(config.polygonscan.apiKey),
    },
  });
  adminPanel.register();
  const dailyLeaderboard = new DailyLeaderboard(new DataApi(config.api), poster, database);
  const marketHeatmap = new MarketHeatmap(poster, database);
  const postWalletPerformanceUpdates = async (wallet: string, walletName?: string) => {
    const alertCount = traderPerformanceRepo.getWalletAlertCount(wallet);
    const backtest = traderPerformanceRepo.getBacktest(wallet);

    if (
      backtest &&
      backtest.resolvedTrades >= 5 &&
      traderPerformanceRepo.shouldPostBacktest(wallet, alertCount)
    ) {
      await poster.postBacktest(backtest);
      traderPerformanceRepo.markBacktestPosted(wallet, alertCount);
      logger.info(`Posted trader backtest for ${wallet} at ${alertCount} alerts`);
    }

    if (alertCount >= 10) {
      const performanceAlerts = traderPerformanceRepo.getPendingPerformanceAlerts(wallet, backtest);
      for (const performanceAlert of performanceAlerts) {
        const displayName = walletName || traderPerformanceRepo.getWalletDisplayName(wallet);
        await poster.postPerformanceAlert(wallet, displayName, performanceAlert);
        traderPerformanceRepo.markPerformanceAlertPosted(wallet, performanceAlert.type);
        logger.info(`Posted ${performanceAlert.type} performance alert for ${wallet}`);
      }
    }
  };
  const tracker = new WhaleTracker(config, runtimeConfig, async (enrichedTrade) => {
    try {
      await poster.postAlert(enrichedTrade);
      walletTradeRepo.markAlerted(
        enrichedTrade.trade.proxyWallet,
        enrichedTrade.trade.conditionId,
        enrichedTrade.trade.timestamp,
      );
      traderPerformanceRepo.recordAlert(
        enrichedTrade.trade.proxyWallet,
        enrichedTrade.trade.conditionId,
        enrichedTrade.marketInfo.question || enrichedTrade.trade.title,
        enrichedTrade.trade.outcome || String(enrichedTrade.trade.outcomeIndex),
        enrichedTrade.trade.price,
        enrichedTrade.trade.timestamp,
      );
      const alertCount = traderPerformanceRepo.getWalletAlertCount(enrichedTrade.trade.proxyWallet);
      if (alertCount >= 10 && alertCount % 5 === 0) {
        await postWalletPerformanceUpdates(
          enrichedTrade.trade.proxyWallet,
          enrichedTrade.trade.name || enrichedTrade.trade.pseudonym || undefined,
        );
      }
      logger.info(`Posted alert: ${enrichedTrade.trade.title} - $${enrichedTrade.trade.usdcSize}`);
    } catch (error) {
      logger.error('Failed to post alert:', error);
    }
  }, {
    database,
    walletTradeRepo,
    insiderTracker,
    polygonscanApi,
    polynterApi,
    newsCorrelator,
    priceHistory,
  });
  const resolutionChecker = new ResolutionChecker(
    gammaApi,
    walletTradeRepo,
    traderPerformanceRepo,
    poster,
  );

  const sampleTrade = await tracker.runStartupSmokeTest(poster.getCardGenerator(), config.runtime.sampleCardPath);
  await poster.writeSampleOutput(sampleTrade, config.runtime.sampleCaptionPath);
  await poster.launch();
  void poster.getBot().launch({ dropPendingUpdates: true });
  await tracker.start();
  resolutionChecker.start();
  dailyLeaderboard.start();
  marketHeatmap.start();

  const shutdown = () => {
    logger.info('Shutting down...');
    if (polynterRefreshTimer) {
      clearInterval(polynterRefreshTimer);
      polynterRefreshTimer = null;
    }
    tracker.stop();
    resolutionChecker.stop();
    dailyLeaderboard.stop();
    marketHeatmap.stop();
    poster.stop();
    poster.getBot().stop('SIGTERM');
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
