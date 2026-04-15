import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger';

const CONFIG_PATH = path.resolve(process.cwd(), 'data', 'admin-config.json');

export interface RuntimeSettings {
  minTradeSize: number;
  maxAlertsPerWalletPerMarket: number;
  referralUrl: string;
  referralButtonText: string;
  firehoseEnabled: boolean;
  hashdiveEnabled: boolean;
  structEnabled: boolean;
  scraperEnabled: boolean;
  polynterEnabled: boolean;
  paused: boolean;
}

export class RuntimeConfigManager extends EventEmitter {
  private settings: RuntimeSettings;

  constructor(defaults: RuntimeSettings) {
    super();
    this.settings = { ...defaults };
    this.load();
  }

  get<K extends keyof RuntimeSettings>(key: K): RuntimeSettings[K] {
    return this.settings[key];
  }

  set<K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]): void {
    this.settings[key] = value;
    this.save();
    this.emit('change', key, value);
  }

  getAll(): Readonly<RuntimeSettings> {
    return { ...this.settings };
  }

  private load(): void {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Partial<RuntimeSettings>;
        this.settings = { ...this.settings, ...raw };
        logger.info('Runtime config loaded from admin-config.json');
      }
    } catch (err) {
      logger.warn('Failed to load admin config, using defaults', err);
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      logger.warn('Failed to save admin config', err);
    }
  }
}
