import { WebSocketServer, type WebSocket } from "ws";
import { sanitizeText, type PresencePlayer } from "@viceblock/shared";

const port = Number(process.env.GAME_SERVER_PORT ?? 4050);
const wss = new WebSocketServer({ port });

interface Client {
  socket: WebSocket;
  player: PresencePlayer;
}

const clients = new Set<Client>();

wss.on("connection", (socket) => {
  const player: PresencePlayer = {
    id: `live-${Math.random().toString(36).slice(2, 10)}`,
    username: "rookie",
    x: 0,
    y: 0,
    heading: 0,
    inVehicle: false,
    updatedAt: Date.now(),
  };
  const client: Client = { socket, player };
  clients.add(client);

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as Partial<PresencePlayer>;
      player.username = sanitizeText(msg.username ?? player.username, 16);
      if (typeof msg.x === "number") player.x = msg.x;
      if (typeof msg.y === "number") player.y = msg.y;
      if (typeof msg.heading === "number") player.heading = msg.heading;
      player.inVehicle = Boolean(msg.inVehicle);
      player.updatedAt = Date.now();
    } catch {
      /* ignore malformed */
    }
  });

  socket.on("close", () => {
    clients.delete(client);
  });
});

setInterval(() => {
  const players = [...clients].map((c) => c.player);
  const payload = JSON.stringify({ type: "presence", players });
  for (const c of clients) {
    if (c.socket.readyState === c.socket.OPEN) c.socket.send(payload);
  }
}, Number(process.env.GAME_SERVER_TICK_MS ?? 80));

console.log(`VICEBLOCK presence server :${port}`);
