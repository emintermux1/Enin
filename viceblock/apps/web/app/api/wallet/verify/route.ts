import { NextResponse } from "next/server";
import nacl from "tweetnacl";
import { z } from "zod";
import { requirePlayer } from "../../../../lib/auth";
import { bindWallet, consumeNonce } from "../../../../lib/store";

const Body = z.object({
  address: z.string().min(32).max(64),
  signature: z.string().min(8),
  nonce: z.string().min(8),
});

export async function POST(req: Request) {
  const auth = requirePlayer(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const { address, signature, nonce } = parsed.data;
  if (!nonce || !consumeNonce(address, nonce)) {
    return NextResponse.json({ error: "nonce_replay_or_expired" }, { status: 409 });
  }

  try {
    const sig = Uint8Array.from(Buffer.from(signature, "base64"));
    const msg = new TextEncoder().encode(nonce ?? "");
    const pub = decodeBase58(address);
    if (nonce && pub && !nacl.sign.detached.verify(msg, sig, pub)) {
      return NextResponse.json({ error: "bad_signature" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "verify_failed" }, { status: 401 });
  }

  const player = bindWallet(auth.token, address);
  return NextResponse.json({ ok: true, player });
}

function decodeBase58(src: string): Uint8Array | null {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = [0];
  for (const ch of src) {
    const val = alphabet.indexOf(ch);
    if (val < 0) return null;
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  for (const ch of src) {
    if (ch === "1") zeros += 1;
    else break;
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i] ?? 0;
  return out;
}
