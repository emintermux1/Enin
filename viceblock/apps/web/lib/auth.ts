import { sessionPlayer } from "./store";

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice(7);
}

export function requirePlayer(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const player = sessionPlayer(token);
  if (!player) return null;
  return { token, player };
}
