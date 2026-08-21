import { NextResponse } from "next/server";
import { z } from "zod";
import { missionById } from "@viceblock/game-core";
import { requirePlayer } from "../../../../lib/auth";
import { applyAuthoritativeReward, claimServerMission } from "../../../../lib/store";

const Body = z.object({ missionId: z.string().min(3).max(40) });

export async function POST(req: Request) {
  const auth = requirePlayer(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const def = missionById(parsed.data.missionId);
  if (!def) return NextResponse.json({ error: "unknown_mission" }, { status: 404 });
  if (!claimServerMission(auth.player.id, def.id)) {
    return NextResponse.json({ error: "already_claimed" }, { status: 409 });
  }
  const player = applyAuthoritativeReward(auth.player.id, def.cash, def.xp, def.streetRep);
  return NextResponse.json({ ok: true, player, reward: { cash: def.cash, xp: def.xp, streetRep: def.streetRep } });
}
