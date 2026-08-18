import { NextResponse } from "next/server";
import { sanitizeText } from "@viceblock/shared";
import { requirePlayer } from "../../../lib/auth";
import { touchPresence } from "../../../lib/store";

export async function POST(req: Request) {
  const auth = requirePlayer(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const players = touchPresence(auth.token, {
    username: sanitizeText(typeof body.username === "string" ? body.username : auth.player.username, 16),
    x: num(body.x),
    y: num(body.y),
    heading: num(body.heading),
    inVehicle: Boolean(body.inVehicle),
  });
  return NextResponse.json({ players });
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
