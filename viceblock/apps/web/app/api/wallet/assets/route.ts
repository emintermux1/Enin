import { NextResponse } from "next/server";
import { requirePlayer } from "../../../../lib/auth";
import { fetchWalletAssets } from "../../../../lib/solana";

export async function GET(req: Request) {
  const auth = requirePlayer(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Assets are only served for a wallet the session proved ownership of.
  const wallet = auth.player.wallet;
  if (!wallet) return NextResponse.json({ error: "no_wallet_bound" }, { status: 409 });
  const assets = await fetchWalletAssets(wallet);
  return NextResponse.json({
    ok: assets.ok,
    sol: Math.round(assets.sol * 1000) / 1000,
    nftCount: assets.nfts.length,
    nfts: assets.nfts.slice(0, 12),
    fetchedAt: assets.fetchedAt,
  });
}
