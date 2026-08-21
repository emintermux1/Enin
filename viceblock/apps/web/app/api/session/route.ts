import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeText } from "@viceblock/shared";
import { createGuest } from "../../../lib/store";

const Body = z.object({
  username: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  const json: unknown = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const username = sanitizeText(parsed.data.username ?? "rookie", 20) || "rookie";
  const { token, player } = createGuest(username);
  return NextResponse.json({ token, player });
}
