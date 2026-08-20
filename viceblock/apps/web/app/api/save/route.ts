import { NextResponse } from "next/server";
import type { InventoryItem } from "@viceblock/shared";
import { requirePlayer } from "../../../lib/auth";
import { putSave } from "../../../lib/store";

export async function GET(req: Request) {
  const auth = requirePlayer(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ player: auth.player });
}

export async function PUT(req: Request) {
  const auth = requirePlayer(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Session state the client owns. XP, rep and completed missions are absent on
  // purpose: those are written only by the authoritative reward endpoints.
  const player = putSave(auth.token, {
    x: num(body.x, auth.player.x),
    y: num(body.y, auth.player.y),
    heading: num(body.heading, auth.player.heading),
    health: num(body.health, auth.player.health),
    armor: num(body.armor, auth.player.armor),
    cash: Math.max(0, num(body.cash, auth.player.cash)),
    bank: Math.max(0, num(body.bank, auth.player.bank)),
    ammo: Math.max(0, num(body.ammo, auth.player.ammo ?? 0)),
    raceBestMs: Math.max(0, num(body.raceBestMs, auth.player.raceBestMs ?? 0)),
    missionStep: Math.max(0, num(body.missionStep, auth.player.missionStep ?? 0)),
    activeMissionId: typeof body.activeMissionId === "string" ? body.activeMissionId : auth.player.activeMissionId,
    inventory: inventory(body.inventory) ?? auth.player.inventory,
    settings: auth.player.settings,
    username: auth.player.username,
  });
  return NextResponse.json({ player });
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Weapons only, capped, so a crafted save cannot conjure an arsenal. */
function inventory(v: unknown): InventoryItem[] | null {
  if (!Array.isArray(v)) return null;
  const allowed = new Set(["pistol", "smg"]);
  return v
    .filter((i): i is InventoryItem => typeof i === "object" && i !== null && allowed.has(String((i as InventoryItem).id)))
    .slice(0, 4);
}
