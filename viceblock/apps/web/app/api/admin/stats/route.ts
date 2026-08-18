import { NextResponse } from "next/server";
import { adminSnapshot } from "../../../../lib/store";

export async function GET(req: Request) {
  const secret = process.env.ADMIN_SECRET ?? "";
  const key = req.headers.get("x-admin-key") ?? "";
  if (!secret || key !== secret) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(adminSnapshot());
}
