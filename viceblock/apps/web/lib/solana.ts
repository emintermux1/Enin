/**
 * Server-side Solana asset indexer with multi-RPC failover, timeouts,
 * and a short cache. The game never trusts the client for wallet
 * contents — it asks the chain itself and reconciles periodically.
 */
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const CACHE_MS = 60_000;
const RPC_TIMEOUT_MS = 5_000;

export interface WalletAssets {
  sol: number;
  /** Mints held with amount 1 / decimals 0 — the standard NFT heuristic. */
  nfts: string[];
  fetchedAt: number;
  /** False when every RPC endpoint failed and this is stale/empty data. */
  ok: boolean;
}

function endpoints(): string[] {
  const list = [process.env.SOLANA_RPC_URL, process.env.SOLANA_RPC_FALLBACK, "https://api.mainnet-beta.solana.com"];
  return list.filter((e): e is string => Boolean(e && e.startsWith("http")));
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  let lastError: unknown = new Error("no rpc endpoints configured");
  for (const url of endpoints()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`rpc ${res.status}`);
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "rpc error");
      if (json.result === undefined) throw new Error("rpc empty result");
      return json.result;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

const cache = new Map<string, WalletAssets>();

interface ParsedTokenAccount {
  account?: {
    data?: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: { uiAmount?: number; decimals?: number };
        };
      };
    };
  };
}

export async function fetchWalletAssets(address: string): Promise<WalletAssets> {
  const cached = cache.get(address);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;
  try {
    const [balance, tokens] = await Promise.all([
      rpcCall<{ value: number }>("getBalance", [address]),
      rpcCall<{ value: ParsedTokenAccount[] }>("getParsedTokenAccountsByOwner", [
        address,
        { programId: TOKEN_PROGRAM },
        { encoding: "jsonParsed" },
      ]),
    ]);
    const nfts: string[] = [];
    for (const acc of tokens.value ?? []) {
      const info = acc.account?.data?.parsed?.info;
      const amt = info?.tokenAmount;
      if (info?.mint && amt?.uiAmount === 1 && amt.decimals === 0) nfts.push(info.mint);
    }
    const fresh: WalletAssets = { sol: (balance.value ?? 0) / 1e9, nfts, fetchedAt: Date.now(), ok: true };
    cache.set(address, fresh);
    return fresh;
  } catch {
    // All endpoints failed: return the last good snapshot if we have one.
    if (cached) return { ...cached, ok: false };
    const empty: WalletAssets = { sol: 0, nfts: [], fetchedAt: Date.now(), ok: false };
    return empty;
  }
}
