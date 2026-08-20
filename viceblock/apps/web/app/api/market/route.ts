import { NextResponse } from "next/server";
import { GAME_NAME } from "@viceblock/shared";

/** Honest empty marketplace — listings only appear after a real mint + wallet listing. */
export async function GET() {
  return NextResponse.json({
    listings: [],
    note: `Marketplace prototype. No simulated inventory. Connect a wallet that holds ${GAME_NAME} mints.`,
  });
}
