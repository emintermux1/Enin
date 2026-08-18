import { NextResponse } from "next/server";

/** Honest empty marketplace — listings only appear after a real mint + wallet listing. */
export async function GET() {
  return NextResponse.json({
    listings: [],
    note: "Marketplace prototype. No simulated inventory. Connect a wallet that holds VICEBLOCK mints.",
  });
}
