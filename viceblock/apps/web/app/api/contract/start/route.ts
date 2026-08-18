import { NextResponse } from "next/server";
import { generateContract } from "@viceblock/game-core";
import { requirePlayer } from "../../../../lib/auth";
import { issueContract } from "../../../../lib/store";

export async function POST(req: Request) {
  const auth = requirePlayer(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const active = issueContract(auth.player.id);
  if (!active) return NextResponse.json({ error: "no_player" }, { status: 404 });
  const def = generateContract(active.seed);
  return NextResponse.json({ ok: true, contract: { ...def, id: active.id } });
}
