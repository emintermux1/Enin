# Deployment

## Local

```bash
cd viceblock
pnpm install
cp .env.example .env
pnpm dev
```

Web: http://localhost:3000  
Presence WS: ws://localhost:4050  
Admin: http://localhost:3000/admin?k=$ADMIN_SECRET

## Production notes

- Deploy `apps/web` to any Node host. Set `SESSION_SECRET` and `ADMIN_SECRET`.
- Run `apps/game-server` as a long-lived process if you want sub-second player replication. HTTP presence still works alone.
- Do not put economic authority in the browser. Mission cash can be confirmed via `POST /api/mission/complete`.
- Wallet verify uses signed nonces with replay flags. Never log seeds. There is no custodian.

## Dates

No launch calendar. Phase 1 is this Southside slice.
