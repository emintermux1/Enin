import { NextResponse } from "next/server";
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
  const player = putSave(auth.token, {
    x: num(body.x, auth.player.x),
    y: num(body.y, auth.player.y),
    heading: num(body.heading, auth.player.heading),
    health: num(body.health, auth.player.health),
    armor: num(body.armor, auth.player.armor),
    settings: auth.player.settings,
    username: auth.player.username,
  });
  return NextResponse.json({ player });
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
