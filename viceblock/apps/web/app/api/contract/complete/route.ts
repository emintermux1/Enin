import { NextResponse } from "next/server";
import { z } from "zod";
import { generateContract } from "@viceblock/game-core";
import { bearer, requirePlayer } from "../../../../lib/auth";
import { activeContractSeed, completeContract, sessionPlayer } from "../../../../lib/store";

const Body = z.object({ contractId: z.string().min(3).max(48) });

export async function POST(req: Request) {
  const auth = requirePlayer(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const active = activeContractSeed(auth.player.id);
  if (!active || active.id !== parsed.data.contractId) {
    return NextResponse.json({ error: "no_active_contract" }, { status: 409 });
  }
  // Rewards come from the server-held seed, never from the client.
  const def = generateContract(active.seed);
  if (!completeContract(auth.player.id, active.id, def.reward, def.xp, def.rep)) {
    return NextResponse.json({ error: "already_claimed" }, { status: 409 });
  }
  const player = sessionPlayer(bearer(req) ?? "");
  return NextResponse.json({ ok: true, player, reward: { cash: def.reward, xp: def.xp, streetRep: def.rep } });
}
