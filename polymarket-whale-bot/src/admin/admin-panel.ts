import Database from 'better-sqlite3';
import { Context, Telegraf } from 'telegraf';
import { RuntimeConfigManager } from './runtime-config';
import { logger } from '../utils/logger';

interface AdminPanelOptions {
  adminUserId: number;
  database: Database.Database;
  startTime: number;
  channelId: string;
  hasApiKeys: {
    hashdive: boolean;
    struct: boolean;
    polygonscan: boolean;
  };
}

interface CountRow {
  count: number;
}

interface TimestampRow {
  timestamp: number | null;
}

const SOURCE_KEYS = {
  firehose: 'firehoseEnabled',
  hashdive: 'hashdiveEnabled',
  struct: 'structEnabled',
  scraper: 'scraperEnabled',
  polynter: 'polynterEnabled',
} as const;

type SourceName = keyof typeof SOURCE_KEYS;

export class AdminPanel {
  private registered = false;

  constructor(
    private readonly bot: Telegraf,
    private readonly runtimeConfig: RuntimeConfigManager,
    private readonly options: AdminPanelOptions,
  ) {}

  register(): void {
    if (this.registered) {
      return;
    }

    if (this.options.adminUserId <= 0) {
      logger.warn('Admin panel enabled without ADMIN_USER_ID; all admin commands will reject');
    }

    this.bot.start(this.withAdmin(async (ctx) => {
      await ctx.reply(this.buildWelcomeMessage());
    }));
    this.bot.command('help', this.withAdmin(async (ctx) => {
      await ctx.reply(this.buildWelcomeMessage());
    }));
    this.bot.command('status', this.withAdmin(async (ctx) => {
      await ctx.reply(this.buildStatusMessage());
    }));
    this.bot.command('config', this.withAdmin(async (ctx) => {
      await ctx.reply(this.buildConfigMessage());
    }));
    this.bot.command('sources', this.withAdmin(async (ctx) => {
      await ctx.reply(this.buildSourcesMessage());
    }));
    this.bot.command('pause', this.withAdmin(async (ctx) => {
      this.runtimeConfig.set('paused', true);
      await ctx.reply('⏸ Bot paused. No new alerts will be posted. Use /resume to restart.');
    }));
    this.bot.command('resume', this.withAdmin(async (ctx) => {
      this.runtimeConfig.set('paused', false);
      await ctx.reply('▶️ Bot resumed. Tracking is active.');
    }));
    this.bot.command('stats', this.withAdmin(async (ctx) => {
      await ctx.reply(this.buildStatsMessage());
    }));
    this.bot.command('setmin', this.withAdmin(async (ctx) => {
      const rawValue = this.getCommandArgs(ctx);
      const amount = this.parseNumber(rawValue);
      if (!Number.isFinite(amount) || amount <= 0) {
        await ctx.reply('Usage: /setmin <positive amount>');
        return;
      }
      this.runtimeConfig.set('minTradeSize', amount);
      await ctx.reply(`✅ Min trade size updated: ${this.formatUsd(amount)}`);
    }));
    this.bot.command('setmax', this.withAdmin(async (ctx) => {
      const rawValue = this.getCommandArgs(ctx);
      const amount = this.parseNumber(rawValue);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        await ctx.reply('Usage: /setmax <integer 1-100>');
        return;
      }
      this.runtimeConfig.set('maxAlertsPerWalletPerMarket', amount);
      await ctx.reply(`✅ Max alerts per wallet/market updated: ${this.formatNumber(amount)}/day`);
    }));
    this.bot.command('toggle', this.withAdmin(async (ctx) => {
      const source = this.getCommandArgs(ctx).trim().toLowerCase() as SourceName;
      if (!source || !(source in SOURCE_KEYS)) {
        await ctx.reply('Usage: /toggle <firehose|hashdive|struct|scraper|polynter>');
        return;
      }
      const configKey = SOURCE_KEYS[source];
      const nextValue = !this.runtimeConfig.get(configKey);
      this.runtimeConfig.set(configKey, nextValue);

      const warnings: string[] = [];
      if (source === 'hashdive' && !this.options.hasApiKeys.hashdive) {
        warnings.push("⚠️ No API key configured for hashdive, toggle won't have effect until key is set");
      }
      if (source === 'struct' && !this.options.hasApiKeys.struct) {
        warnings.push("⚠️ No API key configured for struct, toggle won't have effect until key is set");
      }

      await ctx.reply([
        `✅ ${source} is now ${nextValue ? 'ON' : 'OFF'}`,
        ...warnings,
      ].join('\n'));
    }));
    this.bot.command('referral', this.withAdmin(async (ctx) => {
      const text = this.getMessageText(ctx);
      const payload = text.replace(/^\/referral(?:@\w+)?\s*/i, '');
      if (!payload.trim()) {
        await ctx.reply('Usage: /referral <url>\nOptional second line: button text');
        return;
      }

      const [rawUrl = '', ...buttonLines] = payload.split('\n');
      const url = rawUrl.trim();
      const buttonText = buttonLines.join('\n').trim();

      if (!this.isValidUrl(url)) {
        await ctx.reply('Usage: /referral <valid url>');
        return;
      }

      this.runtimeConfig.set('referralUrl', url);
      if (buttonText) {
        this.runtimeConfig.set('referralButtonText', buttonText);
      }

      await ctx.reply([
        '✅ Referral updated',
        `🔗 URL: ${this.runtimeConfig.get('referralUrl')}`,
        `📢 Button: ${this.runtimeConfig.get('referralButtonText')}`,
      ].join('\n'));
    }));

    this.registered = true;
    logger.info('Telegram admin panel commands registered');
  }

  private withAdmin(handler: (ctx: Context) => Promise<void>): (ctx: Context) => Promise<void> {
    return async (ctx: Context) => {
      if (ctx.from?.id !== this.options.adminUserId) {
        await ctx.reply('⛔ Unauthorized');
        return;
      }

      if (ctx.chat?.type !== 'private') {
        await ctx.reply('⛔ Private chat only');
        return;
      }

      try {
        await handler(ctx);
      } catch (error) {
        logger.warn('Admin command failed', error);
        await ctx.reply('⚠️ Command failed');
      }
    };
  }

  private buildWelcomeMessage(): string {
    return [
      '🤖 Polymarket Whale Bot Admin Panel',
      '',
      'Commands:',
      '/status — Bot status & uptime',
      '/config — Current settings',
      '/setmin <amount> — Min trade size (e.g. /setmin 5000)',
      '/setmax <amount> — Max alerts/wallet/market/day',
      '/sources — Data source status',
      '/toggle <source> — Toggle source on/off',
      '/pause — Pause all tracking',
      '/resume — Resume tracking',
      '/stats — Bot statistics',
      '/referral — Update referral link',
      '/help — This message',
    ].join('\n');
  }

  private buildStatusMessage(): string {
    const settings = this.runtimeConfig.getAll();
    const sources = this.getSourceStates();
    const activeSources = sources.filter((source) => source.enabled).length;

    return [
      '📊 Bot Status',
      '',
      `⏱ Uptime: ${this.formatUptime(Date.now() - this.options.startTime)}`,
      `🔄 State: ${settings.paused ? 'Paused' : 'Running'}`,
      `📡 Sources: ${activeSources}/${sources.length} active`,
      `📢 Channel: ${this.options.channelId}`,
      `💰 Min Trade: ${this.formatUsd(settings.minTradeSize)}`,
      `🔒 Max Alerts: ${this.formatNumber(settings.maxAlertsPerWalletPerMarket)}/wallet/market/day`,
    ].join('\n');
  }

  private buildConfigMessage(): string {
    const settings = this.runtimeConfig.getAll();

    return [
      '⚙️ Current Configuration',
      '',
      `💰 Min Trade Size: ${this.formatUsd(settings.minTradeSize)}`,
      `🔒 Max Alerts/Wallet/Market: ${this.formatNumber(settings.maxAlertsPerWalletPerMarket)}/day`,
      `⏸ Paused: ${settings.paused ? 'YES' : 'NO'}`,
      `🔗 Referral URL: ${this.truncate(settings.referralUrl, 48)}`,
      `📢 Button Text: ${settings.referralButtonText}`,
      '',
      'Data Sources:',
      `  ${this.sourceStatusEmoji(settings.firehoseEnabled)} Firehose: ${this.onOff(settings.firehoseEnabled)}`,
      `  ${this.sourceStatusEmoji(settings.hashdiveEnabled)} Hashdive: ${this.onOff(settings.hashdiveEnabled)}`,
      `  ${this.sourceStatusEmoji(settings.structEnabled)} Struct WS: ${this.onOff(settings.structEnabled)}`,
      `  ${this.sourceStatusEmoji(settings.scraperEnabled)} Scraper: ${this.onOff(settings.scraperEnabled)}`,
      `  ${this.sourceStatusEmoji(settings.polynterEnabled)} Polynter: ${this.onOff(settings.polynterEnabled)}`,
    ].join('\n');
  }

  private buildSourcesMessage(): string {
    const settings = this.runtimeConfig.getAll();

    return [
      '📡 Data Sources',
      '',
      `${this.sourceStatusEmoji(settings.firehoseEnabled)} firehose — Trade firehose (5s polling)`,
      `${this.sourceStatusEmoji(settings.hashdiveEnabled)} hashdive — Hashdive discovery (2m polling)`,
      `${this.sourceStatusEmoji(settings.structEnabled)} struct — Struct WebSocket (${settings.structEnabled ? 'enabled' : 'disabled'})`,
      `${this.sourceStatusEmoji(settings.scraperEnabled)} scraper — Channel scraper (60s polling)`,
      `${this.sourceStatusEmoji(settings.polynterEnabled)} polynter — Polynter enrichment`,
      '',
      'Toggle: /toggle <source>',
      'Example: /toggle struct',
    ].join('\n');
  }

  private buildStatsMessage(): string {
    const startOfDayUtc = Math.floor(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ) / 1000,
    );

    const todayAlerts = this.getCount('SELECT COUNT(*) as count FROM wallet_trades WHERE timestamp > ?', [startOfDayUtc]);
    const todayMarkets = this.getCount('SELECT COUNT(DISTINCT condition_id) as count FROM wallet_trades WHERE timestamp > ?', [startOfDayUtc]);
    const todayWallets = this.getCount('SELECT COUNT(DISTINCT wallet) as count FROM wallet_trades WHERE timestamp > ?', [startOfDayUtc]);
    const allAlerts = this.getCount('SELECT COUNT(*) as count FROM wallet_trades');
    const allMarkets = this.getCount('SELECT COUNT(DISTINCT condition_id) as count FROM wallet_trades');
    const allWallets = this.getCount('SELECT COUNT(DISTINCT wallet) as count FROM wallet_trades');
    const lastAlertTimestamp = this.options.database
      .prepare('SELECT MAX(timestamp) as timestamp FROM wallet_trades')
      .get() as TimestampRow | undefined;

    return [
      '📈 Bot Statistics',
      '',
      'Today:',
      `  📨 Alerts posted: ${this.formatNumber(todayAlerts)}`,
      `  🏪 Unique markets: ${this.formatNumber(todayMarkets)}`,
      `  👛 Unique wallets: ${this.formatNumber(todayWallets)}`,
      '',
      'All time:',
      `  📨 Total alerts: ${this.formatNumber(allAlerts)}`,
      `  🏪 Markets tracked: ${this.formatNumber(allMarkets)}`,
      `  👛 Wallets seen: ${this.formatNumber(allWallets)}`,
      '',
      `Last alert: ${this.formatRelativeTime(lastAlertTimestamp?.timestamp ?? null)}`,
    ].join('\n');
  }

  private getCount(query: string, params: unknown[] = []): number {
    const row = this.options.database.prepare(query).get(...params) as CountRow | undefined;
    return Number(row?.count || 0);
  }

  private getSourceStates(): Array<{ name: SourceName; enabled: boolean }> {
    return (Object.keys(SOURCE_KEYS) as SourceName[]).map((name) => ({
      name,
      enabled: this.runtimeConfig.get(SOURCE_KEYS[name]),
    }));
  }

  private getMessageText(ctx: Context): string {
    if (ctx.message && 'text' in ctx.message) {
      return ctx.message.text;
    }
    return '';
  }

  private getCommandArgs(ctx: Context): string {
    const text = this.getMessageText(ctx);
    return text.replace(/^\/\w+(?:@\w+)?\s*/i, '').trim();
  }

  private parseNumber(raw: string): number {
    return Number(raw.replace(/[$,\s]/g, ''));
  }

  private isValidUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tg:';
    } catch {
      return false;
    }
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  }

  private formatUsd(value: number): string {
    return `$${this.formatNumber(value)}`;
  }

  private formatUptime(ms: number): string {
    const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];

    if (days > 0) {
      parts.push(`${days}d`);
    }
    if (hours > 0 || days > 0) {
      parts.push(`${hours}h`);
    }
    parts.push(`${minutes}m`);

    return parts.join(' ');
  }

  private formatRelativeTime(timestamp: number | null): string {
    if (!timestamp) {
      return 'Never';
    }

    const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
    if (diffSeconds < 60) {
      return `${diffSeconds}s ago`;
    }
    if (diffSeconds < 3600) {
      return `${Math.floor(diffSeconds / 60)}m ago`;
    }
    if (diffSeconds < 86400) {
      return `${Math.floor(diffSeconds / 3600)}h ago`;
    }
    return `${Math.floor(diffSeconds / 86400)}d ago`;
  }

  private sourceStatusEmoji(enabled: boolean): string {
    return enabled ? '🟢' : '🔴';
  }

  private onOff(enabled: boolean): string {
    return enabled ? 'ON' : 'OFF';
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 3)}...`;
  }
}
