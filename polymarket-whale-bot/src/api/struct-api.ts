import WebSocket, { RawData } from 'ws';
import { logger } from '../utils/logger';

export interface StructWhaleAlert {
  type: 'trader_whale_trade';
  data: {
    wallet?: string;
    user_address?: string;
    market_id?: string;
    condition_id?: string;
    side?: string;
    amount?: number;
    price?: number;
    timestamp?: number;
    market_title?: string;
    market_slug?: string;
    outcome?: string;
    outcome_index?: number;
    outcomeIndex?: number;
    market_outcome?: string;
    token_name?: string;
    token_label?: string;
    [key: string]: unknown;
  };
}

interface StructAlertEnvelope {
  type?: unknown;
  alert_type?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

export interface StructApiOptions {
  apiKey: string;
  onWhaleAlert: (alert: StructWhaleAlert) => Promise<void>;
  onError?: (error: Error) => void;
}

export class StructApi {
  private static readonly MAX_RECONNECT_ATTEMPTS = 10;
  private static readonly RECONNECT_BASE_DELAY_MS = 5_000;
  private static readonly PING_INTERVAL_MS = 25_000;

  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private running = false;
  private reconnectAttempts = 0;

  constructor(private readonly options: StructApiOptions) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.cleanup();
  }

  private connect(): void {
    if (!this.running) {
      return;
    }

    const url = `wss://api.struct.to/ws/alerts?api-key=${this.options.apiKey}`;
    logger.info('Connecting to Struct alerts WebSocket...');

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      logger.info('Struct WebSocket connected');
      this.reconnectAttempts = 0;
      this.startPing();
    });

    this.ws.on('message', (data: RawData) => {
      void this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(`Struct WebSocket closed: ${code} ${reason.toString()}`);
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      logger.error('Struct WebSocket error', error);
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private async handleMessage(data: RawData): Promise<void> {
    try {
      const parsed = JSON.parse(data.toString()) as StructAlertEnvelope;
      const messageType = this.getMessageType(parsed);

      if (!messageType || messageType === 'pong' || messageType === 'ping') {
        return;
      }

      if (messageType === 'trader_whale_trade') {
        await this.options.onWhaleAlert({
          type: 'trader_whale_trade',
          data: this.extractAlertData(parsed),
        });
        return;
      }

      logger.debug(`Struct alert type: ${messageType}`);
    } catch (error) {
      logger.warn('Failed to parse Struct message', error);
    }
  }

  private getMessageType(message: StructAlertEnvelope): string {
    if (typeof message.type === 'string') {
      return message.type;
    }
    if (typeof message.alert_type === 'string') {
      return message.alert_type;
    }
    return '';
  }

  private extractAlertData(message: StructAlertEnvelope): StructWhaleAlert['data'] {
    const nestedData = typeof message.data === 'object' && message.data !== null
      ? message.data as Record<string, unknown>
      : {};
    const topLevelData = Object.fromEntries(
      Object.entries(message).filter(([key]) => key !== 'type' && key !== 'alert_type' && key !== 'data'),
    );
    return {
      ...topLevelData,
      ...nestedData,
    };
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, StructApi.PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (!this.pingTimer) {
      return;
    }
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.ws) {
      return;
    }
    this.ws.removeAllListeners();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (!this.running) {
      return;
    }
    if (this.reconnectAttempts >= StructApi.MAX_RECONNECT_ATTEMPTS) {
      logger.error('Struct WebSocket max reconnect attempts reached');
      return;
    }

    const delay = StructApi.RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts += 1;
    logger.info(`Struct WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
