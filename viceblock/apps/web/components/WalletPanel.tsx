"use client";

import { sanitizeText } from "@viceblock/shared";
import { useState } from "react";

interface Props {
  session: string;
  onClose: () => void;
}

type Status = "idle" | "pending" | "ok" | "err";

export function WalletPanel({ session, onClose }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("Phantom, Solflare, or Backpack. We never ask for a seed.");
  const [addr, setAddr] = useState("");

  async function connect(kind: "phantom" | "solflare" | "backpack"): Promise<void> {
    setStatus("pending");
    try {
      const provider = providerOf(kind);
      if (!provider) {
        setStatus("err");
        setMsg(`${kind} is not installed in this browser.`);
        return;
      }
      const resp = (await provider.connect()) as { publicKey?: { toBase58?: () => string; toString?: () => string } };
      const address = resp.publicKey?.toBase58?.() ?? resp.publicKey?.toString?.() ?? "";
      if (!address) throw new Error("no public key");
      const nonceRes = await fetch("/api/wallet/nonce", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
        body: JSON.stringify({ address }),
      });
      const nonceJson = (await nonceRes.json()) as { nonce?: string; error?: string };
      if (!nonceRes.ok || !nonceJson.nonce) throw new Error(nonceJson.error ?? "nonce failed");
      const encoded = new TextEncoder().encode(nonceJson.nonce);
      const signed = (await provider.signMessage(encoded, "utf8")) as { signature: Uint8Array };
      const sig = btoa(String.fromCharCode(...Array.from(signed.signature)));
      const ver = await fetch("/api/wallet/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
        body: JSON.stringify({ address, signature: sig, nonce: nonceJson.nonce }),
      });
      const verJson = (await ver.json()) as { ok?: boolean; error?: string };
      if (!ver.ok || !verJson.ok) throw new Error(verJson.error ?? "verify failed");
      setAddr(address);
      setStatus("ok");
      setMsg("Session bound. Gameplay stays off-chain. Ownership can settle later.");
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : "wallet rejected");
    }
  }

  return (
    <aside className="panel">
      <header>
        <strong>CONNECT WALLET</strong>
        <button type="button" onClick={onClose}>
          ×
        </button>
      </header>
      <p>{sanitizeText(msg, 160)}</p>
      {addr ? <code>{addr.slice(0, 4)}…{addr.slice(-4)}</code> : null}
      <div className="row">
        <button type="button" disabled={status === "pending"} onClick={() => void connect("phantom")}>
          Phantom
        </button>
        <button type="button" disabled={status === "pending"} onClick={() => void connect("solflare")}>
          Solflare
        </button>
        <button type="button" disabled={status === "pending"} onClick={() => void connect("backpack")}>
          Backpack
        </button>
      </div>
      <small>No seed phrases. Signed nonce only. Marketplace listings stay empty until you mint.</small>
      <style jsx>{`
        .panel {
          position: absolute;
          left: 18px;
          top: 86px;
          width: min(320px, 84vw);
          background: #1a1410;
          border: 1px solid #e6c39a;
          padding: 12px;
          z-index: 5;
        }
        header {
          display: flex;
          justify-content: space-between;
        }
        .row {
          display: flex;
          gap: 6px;
          margin: 10px 0;
        }
        button {
          background: #c45a32;
          color: #1a1410;
          border: 0;
          padding: 8px 10px;
          cursor: pointer;
        }
        header button {
          background: transparent;
          color: #f3e6d2;
        }
        code,
        small,
        p {
          color: #d8c4ae;
          font-size: 12px;
        }
      `}</style>
    </aside>
  );
}

function providerOf(kind: "phantom" | "solflare" | "backpack"): WalletProvider | null {
  const w = window as unknown as {
    solana?: WalletProvider & { isPhantom?: boolean };
    solflare?: WalletProvider;
    backpack?: { solana?: WalletProvider };
  };
  if (kind === "phantom" && w.solana?.isPhantom) return w.solana;
  if (kind === "solflare" && w.solflare) return w.solflare;
  if (kind === "backpack" && w.backpack?.solana) return w.backpack.solana;
  return null;
}

interface WalletProvider {
  connect: () => Promise<unknown>;
  signMessage: (msg: Uint8Array, enc: string) => Promise<{ signature: Uint8Array }>;
}
