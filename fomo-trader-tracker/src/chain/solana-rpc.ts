import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { ParsedTransaction, SignatureEntry } from '../types';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

interface RpcError {
  code: number;
  message: string;
}

interface RpcResponse<T> {
  id: number | string;
  result?: T;
  error?: RpcError;
}

interface ParsedTokenAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          tokenAmount: { amount: string; decimals: number; uiAmount: number | null };
        };
      };
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialises RPC traffic so a free-tier endpoint is not tripped into 429s.
 * Requests are spaced by `minRequestSpacingMs` and retried with backoff.
 */
class RequestGate {
  private chain: Promise<void> = Promise.resolve();
  private active = 0;

  constructor(
    private readonly spacingMs: number,
    private readonly maxConcurrency: number
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    while (this.active >= this.maxConcurrency) {
      await sleep(this.spacingMs);
    }
    const slot = this.chain.then(() => sleep(this.spacingMs));
    this.chain = slot;
    await slot;

    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
    }
  }
}

export class SolanaRpc {
  private readonly http: AxiosInstance;
  private readonly gate: RequestGate;
  private nextId = 1;

  constructor(private readonly rpcUrl: string = config.solana.rpcUrl) {
    this.http = axios.create({
      baseURL: this.rpcUrl,
      timeout: config.solana.timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
    this.gate = new RequestGate(config.solana.minRequestSpacingMs, config.solana.maxConcurrency);
  }

  /**
   * Throws once retries are exhausted. Callers must not treat an RPC failure as
   * "wallet holds nothing", otherwise a flaky endpoint silently rejects wallets
   * that actually qualify.
   */
  private async send<T>(method: string, params: unknown[]): Promise<T | null> {
    const payload = { jsonrpc: '2.0', id: this.nextId++, method, params };
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= config.solana.retryCount; attempt += 1) {
      try {
        const response = await this.gate.run(() => this.http.post<RpcResponse<T>>('', payload));
        const { result, error } = response.data;
        if (error) {
          // Missing/pruned data is a permanent answer, not a transient failure.
          if (error.code === -32004 || error.code === -32009) {
            return null;
          }
          throw new Error(error.message);
        }
        return result ?? null;
      } catch (err) {
        lastError = err;
        if (attempt < config.solana.retryCount) {
          await sleep(500 * 2 ** attempt);
        }
      }
    }

    throw new Error(`${method} failed after ${config.solana.retryCount + 1} attempts: ${describeError(lastError)}`);
  }

  async getSignaturesForAddress(address: string, limit: number, before?: string): Promise<SignatureEntry[]> {
    const options: Record<string, unknown> = { limit: Math.min(limit, 1000) };
    if (before) {
      options.before = before;
    }
    const result = await this.send<SignatureEntry[]>('getSignaturesForAddress', [address, options]);
    return result ?? [];
  }

  /** Walks backwards through history until `limit` signatures are collected. */
  async getSignaturesPaged(address: string, limit: number): Promise<SignatureEntry[]> {
    const collected: SignatureEntry[] = [];
    let before: string | undefined;

    while (collected.length < limit) {
      const pageSize = Math.min(1000, limit - collected.length);
      const page = await this.getSignaturesForAddress(address, pageSize, before);
      if (page.length === 0) {
        break;
      }
      collected.push(...page);
      const last = page[page.length - 1];
      if (!last) {
        break;
      }
      before = last.signature;
      if (page.length < pageSize) {
        break;
      }
    }

    return collected;
  }

  async getTransaction(signature: string): Promise<ParsedTransaction | null> {
    return this.send<ParsedTransaction>('getTransaction', [
      signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
  }

  /** Bulk fetch where individual failures are skipped rather than fatal. */
  async getTransactions(signatures: string[]): Promise<Map<string, ParsedTransaction>> {
    const found = new Map<string, ParsedTransaction>();
    const results = await Promise.all(
      signatures.map(async (signature) => {
        try {
          return { signature, tx: await this.getTransaction(signature) };
        } catch {
          return { signature, tx: null };
        }
      })
    );
    for (const { signature, tx } of results) {
      if (tx) {
        found.set(signature, tx);
      }
    }
    return found;
  }

  /** Top holders of a mint, as token-account addresses. */
  async getTokenLargestAccounts(mint: string): Promise<string[]> {
    const result = await this.send<{ value: Array<{ address: string }> }>('getTokenLargestAccounts', [mint]);
    return (result?.value ?? []).map((entry) => entry.address);
  }

  /** Resolves token-account addresses to their owning wallets. */
  async getTokenAccountOwners(tokenAccounts: string[]): Promise<string[]> {
    if (tokenAccounts.length === 0) {
      return [];
    }
    const result = await this.send<{
      value: Array<{ data: { parsed: { info: { owner: string } } } } | null>;
    }>('getMultipleAccounts', [tokenAccounts, { encoding: 'jsonParsed' }]);

    const owners: string[] = [];
    for (const entry of result?.value ?? []) {
      const owner = entry?.data?.parsed?.info?.owner;
      if (owner) {
        owners.push(owner);
      }
    }
    return owners;
  }

  async getSolBalanceLamports(wallet: string): Promise<number> {
    const result = await this.send<{ value: number }>('getBalance', [wallet]);
    return result?.value ?? 0;
  }

  async getTokenHoldings(wallet: string): Promise<Array<{ mint: string; uiAmount: number; decimals: number }>> {
    const holdings: Array<{ mint: string; uiAmount: number; decimals: number }> = [];

    for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const result = await this.send<{ value: ParsedTokenAccount[] }>('getTokenAccountsByOwner', [
        wallet,
        { programId },
        { encoding: 'jsonParsed' },
      ]);

      for (const entry of result?.value ?? []) {
        const info = entry.account.data.parsed.info;
        const uiAmount = info.tokenAmount.uiAmount ?? 0;
        if (uiAmount > 0) {
          holdings.push({ mint: info.mint, uiAmount, decimals: info.tokenAmount.decimals });
        }
      }
    }

    return holdings;
  }
}

function describeError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return `${err.response?.status ?? 'network'} ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export const rpc = new SolanaRpc();
