import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlayer } from "../../../../lib/auth";
import { issueNonce } from "../../../../lib/store";

const Body = z.object({ address: z.string().min(32).max(64) });

export async function POST(req: Request) {
  if (!requirePlayer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_address" }, { status: 400 });
  const rec = issueNonce(parsed.data.address);
  return NextResponse.json({ nonce: rec.nonce, expiresAt: rec.expiresAt });
}
