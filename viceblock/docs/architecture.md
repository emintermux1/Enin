# VICEBLOCK architecture

## Why this stack

- **Next.js App Router** for the public URL, guest session APIs, wallet nonce/verify, presence heartbeat, and admin gate.
- **Custom Canvas 2D engine** instead of Phaser so the first session is one bundle, 60fps, and not blocked on an extra scene graph.
- **`@viceblock/game-core`** holds heat, economy, missions, joystick math, and vehicle damage. Client and tests share it. The browser is not trusted for cash claims.
- **JSON file store** (with the Postgres schema checked in) so the slice runs without Docker. `DATABASE_URL` is reserved.
- **Optional WebSocket presence** (`apps/game-server`) plus HTTP `/api/presence` so two browsers can see each other without faking sockets.

## On-chain vs off-chain

Off-chain: movement, shooting, NPCs, missions, XP, heat, inventory.
On-chain (hooks only): wallet signature login, future NFT ownership, marketplace settlement. `$VICE` is not launched.

## Easy police

Cops are intentionally slower than the player, escalate only after long line-of-sight, and drop a star after a few seconds hidden. AI assist copy points at alleys, Maya's garage, and car swaps.

## Audio

Radio is a Web Audio sequencer (NOVA FM, PALM RADIO, UNDERGROUND 88). There are no missing mp3s. Playback starts on ENTER SOUTHSIDE (user gesture). If the browser blocks it, TAP FOR MUSIC stays visible.

## Unfinished (honest)

- Full 8-district city, crew wars, extraction, compressed NFT mint pipeline
- Authoritative hit detection on the socket server
- Marketplace listings (endpoint returns a real empty list)
- Postgres adapter (schema exists, file store is live)
