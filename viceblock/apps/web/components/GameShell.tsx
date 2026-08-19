"use client";

import { sanitizeText } from "@viceblock/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HudSnapshot } from "../game/hud";
import { ViceblockRuntime3D } from "../game3d/runtime3d";
import { blockRichPaste } from "../lib/sanitize-dom";
import { WalletPanel } from "./WalletPanel";

const EMPTY: HudSnapshot = {
  cash: 500,
  bank: 0,
  heat: 0,
  health: 100,
  armor: 0,
  xp: 0,
  level: 1,
  streetRep: 0,
  objective: "Tap in",
  prompt: "",
  assist: "",
  station: "NOVA FM",
  musicOn: false,
  wantedFlash: false,
  dayLabel: "DUSK",
  weather: "clear",
  inVehicle: false,
  vehicleHp: 100,
  dialogue: null,
  toast: "",
  phoneOpen: false,
  interior: null,
  username: "rookie",
  others: 0,
  lockpick: null,
  jailLeft: 0,
  news: "",
  lootValue: 0,
  searchZone: false,
  gamepad: false,
  contractLine: "",
  weapon: "Fists",
  ammo: 0,
  raceBestMs: 0,
  waypointBearing: null,
};

function xpPct(xp: number, level: number): number {
  // Mirrors the runtime's level curve: level = floor(1 + sqrt(xp / 180)).
  const base = 180 * (level - 1) ** 2;
  const next = 180 * level ** 2;
  if (next <= base) return 0;
  return Math.max(0, Math.min(100, ((xp - base) / (next - base)) * 100));
}

export function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const bigMapRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<ViceblockRuntime3D | null>(null);
  const sessionRef = useRef("");
  const [hud, setHud] = useState<HudSnapshot>(EMPTY);
  const [started, setStarted] = useState(false);
  const [bootError, setBootError] = useState("");
  const [name, setName] = useState("rookie");
  const [phoneTab, setPhoneTab] = useState<"map" | "jobs" | "crew" | "bank" | "profile">("jobs");
  const [walletOpen, setWalletOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [session, setSession] = useState<string>("");
  const [wallet, setWallet] = useState<{ address: string; sol: number; nfts: number; live: boolean } | null>(null);

  const resize = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.style.width = `${window.innerWidth}px`;
    c.style.height = `${window.innerHeight}px`;
    gameRef.current?.engine.resize();
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    const prevent = (e: Event): void => e.preventDefault();
    document.addEventListener("gesturestart", prevent as EventListener);
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("gesturestart", prevent as EventListener);
    };
  }, [resize]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const game = new ViceblockRuntime3D(c);
    game.minimap = minimapRef.current;
    gameRef.current = game;
    game.attach();
    game.onHud = (h) => setHud(h);
    game.onPersist = (save) => {
      const token = sessionRef.current;
      if (!token) return;
      void fetch("/api/save", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(save),
      });
    };
    game.onMissionComplete = (missionId) => {
      const token = sessionRef.current;
      if (!token) return;
      void fetch("/api/mission/complete", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ missionId }),
      }).catch(() => undefined);
    };
    game.onContractComplete = (contractId) => {
      const token = sessionRef.current;
      if (!token) return;
      void fetch("/api/contract/complete", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ contractId }),
      }).catch(() => undefined);
    };
    return () => {
      game.detach();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!started || !session) return;
    const t = window.setInterval(() => {
      const g = gameRef.current;
      if (!g) return;
      const body = {
        x: g.player.x,
        y: g.player.z,
        heading: g.player.heading,
        inVehicle: Boolean(g.player.vehicleId),
        username: g.username,
      };
      void fetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((d: { players?: Array<{ id: string; username: string; x: number; y: number; heading: number; inVehicle: boolean; updatedAt: number }> }) => {
          if (Array.isArray(d.players)) g.setRemotes(d.players);
        })
        .catch(() => undefined);
    }, 800);
    return () => window.clearInterval(t);
  }, [started, session]);

  useEffect(() => {
    if (!hud.phoneOpen || phoneTab !== "map") return;
    const draw = (): void => {
      const c = bigMapRef.current;
      if (c) gameRef.current?.drawMapCanvas(c);
    };
    draw();
    const t = window.setInterval(draw, 500);
    return () => window.clearInterval(t);
  }, [hud.phoneOpen, phoneTab]);

  async function enterCity(): Promise<void> {
    setBootError("");
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: sanitizeText(name, 20) || "rookie" }),
      });
      const data = (await res.json()) as { token?: string; player?: { username: string } };
      if (!res.ok || !data.token) throw new Error("session failed");
      sessionRef.current = data.token;
      setSession(data.token);
      const g = gameRef.current;
      if (!g) throw new Error("engine missing");
      g.username = sanitizeText(name, 20) || "rookie";
      await g.start();
      if (!g.audio.playing) {
        setBootError("Music blocked — tap the radio chip.");
      }
      setStarted(true);
    } catch (e) {
      setBootError(e instanceof Error ? e.message : "boot failed");
    }
  }

  async function syncWalletAssets(address: string): Promise<void> {
    const token = sessionRef.current;
    if (!token) return;
    try {
      const res = await fetch("/api/wallet/assets", { headers: { authorization: `Bearer ${token}` } });
      const d = (await res.json()) as { ok?: boolean; sol?: number; nftCount?: number };
      if (!res.ok) return;
      setWallet({ address, sol: d.sol ?? 0, nfts: d.nftCount ?? 0, live: Boolean(d.ok) });
      gameRef.current?.setWalletAssets(d.nftCount ?? 0);
    } catch {
      setWallet({ address, sol: 0, nfts: 0, live: false });
    }
  }

  async function pullContract(): Promise<void> {
    const token = sessionRef.current;
    const g = gameRef.current;
    if (!token || !g || g.contract) return;
    try {
      const res = await fetch("/api/contract/start", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { contract?: Parameters<typeof g.startContract>[0] };
      if (res.ok && data.contract) g.startContract(data.contract);
    } catch {
      /* offline: contracts simply unavailable */
    }
  }

  function onStickDown(e: React.PointerEvent<HTMLDivElement>, which: "move" | "aim"): void {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const g = gameRef.current;
    if (!g) return;
    if (which === "move") g.input.beginMoveStick(e.pointerId, x, y);
    else g.input.beginAimStick(e.pointerId, x, y);
  }

  function onStickMove(e: React.PointerEvent<HTMLDivElement>, which: "move" | "aim"): void {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const g = gameRef.current;
    if (!g) return;
    if (which === "move") g.input.moveMoveStick(e.pointerId, x, y);
    else g.input.moveAimStick(e.pointerId, x, y);
  }

  function onStickUp(e: React.PointerEvent<HTMLDivElement>, which: "move" | "aim"): void {
    const g = gameRef.current;
    if (!g) return;
    if (which === "move") g.input.endMoveStick(e.pointerId);
    else g.input.endAimStick(e.pointerId);
  }

  return (
    <div className="shell">
      <canvas ref={canvasRef} className="view" />

      {!started && (
        <div className="gate">
          <p className="kicker">SEASON 1 — SOUTHSIDE</p>
          <h1>VICEBLOCK</h1>
          <p className="lede">
            Follow the gold pillar to Rico. Steal the unlocked Sparrow on the curb. Coral Mart is the red awning.
            Cops are slow. Wallet later.
          </p>
          <label>
            STREET NAME
            <input
              value={name}
              maxLength={20}
              onPaste={(e) => blockRichPaste(e.nativeEvent)}
              onChange={(e) => setName(sanitizeText(e.target.value, 20))}
            />
          </label>
          <button type="button" className="enter" onClick={() => void enterCity()}>
            ENTER SOUTHSIDE
          </button>
          <p className="hint">
            WASD walk · Shift sprint · Space jump/handbrake · E interact · G surrender · click shoot · right-drag camera · R radio · F phone · H assist
            <br />
            Touch: left stick walks (push far to sprint) · right stick aims &amp; fires · drag screen for camera · E/G button acts
          </p>
          {bootError ? <p className="err">{sanitizeText(bootError, 80)}</p> : null}
        </div>
      )}

      {started && (
        <>
          <div className="hud-tl">
            <div className="obj">
              {hud.waypointBearing !== null ? (
                <span className="way" style={{ transform: `rotate(${hud.waypointBearing}rad)` }}>
                  ▲
                </span>
              ) : null}
              {hud.objective}
            </div>
            {hud.assist ? <div className="assist">{hud.assist}</div> : null}
          </div>
          <div className="hud-tr">
            <div className="cash">${hud.cash}</div>
            <div className={`heat h${hud.heat}${hud.wantedFlash ? " hot" : ""}`}>
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className={i < hud.heat ? "on" : ""} />
              ))}
            </div>
            <button
              type="button"
              className={`radio ${hud.musicOn ? "live" : "dead"}`}
              onClick={() => {
                const g = gameRef.current;
                if (!g) return;
                void g.audio.unlock();
                g.audio.cycleStation();
              }}
            >
              {hud.musicOn ? "ON AIR" : "TAP FOR MUSIC"} · {hud.station}
            </button>
            <div className="meta">
              {hud.dayLabel} · {hud.weather} · {hud.others} nearby{hud.gamepad ? " · PAD" : ""}
              {hud.searchZone ? " · SEARCH ZONE" : ""}
              {hud.interior ? ` · INSIDE ${hud.interior.toUpperCase()}` : ""}
            </div>
          </div>
          <div className="hud-br">
            <div className="bars">
              <i className="hp" style={{ width: `${hud.health}%` }} />
              <i className="ar" style={{ width: `${hud.armor}%` }} />
            </div>
            <div className="xpbar">
              <i style={{ width: `${xpPct(hud.xp, hud.level)}%` }} />
            </div>
            <div className="gun">
              LV {hud.level} · {hud.inVehicle ? `RIDE ${hud.vehicleHp}%` : `${hud.weapon}${hud.ammo > 0 ? ` · ${hud.ammo}` : ""}`}
            </div>
          </div>
          {hud.health < 35 && hud.jailLeft <= 0 ? <div className="vignette" /> : null}
          <canvas ref={minimapRef} width={132} height={132} className="minimap" />
          {!hud.inVehicle && <div className="crosshair" />}
          {hud.prompt ? <div className="prompt">{hud.prompt}</div> : null}
          {hud.toast ? <div className="toast">{hud.toast}</div> : null}
          {hud.news ? <div className="news">NOVA NEWS · {hud.news}</div> : null}
          {hud.lootValue > 0 ? <div className="loot">HOT GOODS ${hud.lootValue} · fence at Painted Door</div> : null}

          {hud.lockpick && (
            <div
              className="lockpick"
              onPointerDown={() => {
                const g = gameRef.current;
                if (g) g.input.interactQueued = true;
              }}
            >
              <p>LOCKPICK · picks left {hud.lockpick.picksLeft} · tap / E in the zone</p>
              <div className="track">
                <i
                  className="zone"
                  style={{ left: `${hud.lockpick.zoneStart * 100}%`, width: `${(hud.lockpick.zoneEnd - hud.lockpick.zoneStart) * 100}%` }}
                />
                <i className="pin" style={{ left: `${hud.lockpick.pos * 100}%` }} />
              </div>
            </div>
          )}

          {hud.jailLeft > 0 && (
            <div className="jail">
              <h2>SOUTHSIDE HOLDING</h2>
              <p>Processing takes {hud.jailLeft}s. Contraband confiscated, record updated.</p>
              <button
                type="button"
                onClick={() => {
                  const g = gameRef.current;
                  if (g && !g.payBail()) g.audio.uiClick();
                }}
              >
                PAY BAIL · $120
              </button>
              <p className="fine">Or sit tight. Jail beats the $100 hospital bill.</p>
            </div>
          )}
          {hud.dialogue ? (
            <div className="talk">
              <b>{hud.dialogue.who}</b>
              <p>{hud.dialogue.line}</p>
            </div>
          ) : null}

          <div className={`dock ${menuOpen ? "open" : ""}`}>
            <button type="button" className="menu-toggle" onClick={() => setMenuOpen((v) => !v)}>
              {menuOpen ? "CLOSE" : "MENU"}
            </button>
            <button type="button" onClick={() => gameRef.current && (gameRef.current.player.phone = !gameRef.current.player.phone)}>
              PHONE
            </button>
            <button type="button" onClick={() => setWalletOpen((v) => !v)}>
              WALLET
            </button>
            <button
              type="button"
              onClick={() => {
                const g = gameRef.current;
                if (!g) return;
                void g.audio.unlock();
                g.audio.cycleStation();
              }}
            >
              RADIO
            </button>
            <button
              type="button"
              onClick={() => {
                const g = gameRef.current;
                if (!g) return;
                g.aimAssistOn = !g.aimAssistOn;
                g.audio.uiClick();
              }}
            >
              AIM ASSIST
            </button>
            <button
              type="button"
              onClick={() => {
                const g = gameRef.current;
                if (!g) return;
                const next = g.quality === "low" ? "medium" : g.quality === "medium" ? "high" : "low";
                g.setQuality(next);
                g.audio.uiClick();
              }}
            >
              QUALITY
            </button>
            <button type="button" onClick={() => setDebugOpen((v) => !v)}>
              HELP
            </button>
          </div>

          {debugOpen && (
            <div className="debug">
              <strong>UNSTUCK / HELP</strong>
              <div>
                {(["rico", "mart", "garage", "port", "race"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => gameRef.current?.debugTeleport(s)}>
                    tp {s}
                  </button>
                ))}
              </div>
              <div>
                <button type="button" onClick={() => gameRef.current?.debugSpawnCar()}>
                  spawn car
                </button>
                <button type="button" onClick={() => gameRef.current?.debugGiveWeapon()}>
                  give gun
                </button>
                <button type="button" onClick={() => gameRef.current?.debugHeal()}>
                  heal
                </button>
              </div>
              <div>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => gameRef.current?.debugSetHeat(n)}>
                    heat {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            className="stick move"
            onPointerDown={(e) => onStickDown(e, "move")}
            onPointerMove={(e) => onStickMove(e, "move")}
            onPointerUp={(e) => onStickUp(e, "move")}
            onPointerCancel={(e) => onStickUp(e, "move")}
          >
            <em
              style={{
                transform: `translate(${gameRef.current ? gameRef.current.input.stick.dx * 28 : 0}px, ${gameRef.current ? gameRef.current.input.stick.dy * 28 : 0}px)`,
              }}
            />
          </div>
          <div
            className="stick aim"
            onPointerDown={(e) => onStickDown(e, "aim")}
            onPointerMove={(e) => onStickMove(e, "aim")}
            onPointerUp={(e) => onStickUp(e, "aim")}
            onPointerCancel={(e) => onStickUp(e, "aim")}
          >
            <span>AIM</span>
          </div>
          <button
            type="button"
            className="act"
            onPointerDown={() => {
              const g = gameRef.current;
              if (!g) return;
              // The action button is contextual: it surrenders when the
              // prompt asks for G, otherwise it interacts like E.
              if (hud.prompt.startsWith("G")) g.input.surrenderQueued = true;
              else g.input.interactQueued = true;
            }}
          >
            {hud.prompt.startsWith("G") ? "G" : "E"}
          </button>
          <button
            type="button"
            className="jump"
            onPointerDown={() => gameRef.current?.input.keys.add("Space")}
            onPointerUp={() => gameRef.current?.input.keys.delete("Space")}
            onPointerCancel={() => gameRef.current?.input.keys.delete("Space")}
          >
            {hud.inVehicle ? "BRAKE" : "JUMP"}
          </button>

          {hud.phoneOpen && (
            <div className="phone">
              <header>
                NOVA OS <button type="button" onClick={() => gameRef.current && (gameRef.current.player.phone = false)}>×</button>
              </header>
              <nav>
                {(["jobs", "map", "crew", "bank", "profile"] as const).map((t) => (
                  <button key={t} type="button" className={phoneTab === t ? "on" : ""} onClick={() => setPhoneTab(t)}>
                    {t}
                  </button>
                ))}
              </nav>
              <section>
                {phoneTab === "jobs" && (
                  <div>
                    <p>
                      Active: {hud.objective}
                      <br />
                      Street Rep {hud.streetRep} · LV {hud.level}
                    </p>
                    {hud.contractLine ? (
                      <p>Contract: {hud.contractLine}</p>
                    ) : (
                      <button type="button" className="pull" onClick={() => void pullContract()}>
                        PULL A CONTRACT
                      </button>
                    )}
                  </div>
                )}
                {phoneTab === "map" && (
                  <div>
                    <canvas ref={bigMapRef} width={256} height={256} className="bigmap" />
                    <p className="legend">gold = jobs · ring = objective · blue = cops · red = you</p>
                  </div>
                )}
                {phoneTab === "crew" && <p>Crews unlock after Port Authority. Cupsey already thinks you&apos;re late.</p>}
                {phoneTab === "bank" && (
                  <div>
                    <p>
                      Pocket ${hud.cash}
                      <br />
                      Vault ${hud.bank} — banked cash survives a bust
                    </p>
                    <div className="bankrow">
                      <button type="button" onClick={() => gameRef.current?.bankDeposit(100)}>
                        DEPOSIT $100
                      </button>
                      <button type="button" onClick={() => gameRef.current?.bankWithdraw(100)}>
                        WITHDRAW $100
                      </button>
                    </div>
                    {wallet ? (
                      <p>
                        {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)} · {wallet.sol} SOL · {wallet.nfts} NFT
                        {wallet.live ? "" : " (cached)"}
                        <br />
                        {wallet.nfts > 0 ? "Chainline Mirage unlocked — parked by the walk-up." : "Hold any NFT to unlock the Chainline Mirage."}
                      </p>
                    ) : (
                      <p>No wallet bound. On-chain assets are read from the chain, never trusted from the client.</p>
                    )}
                  </div>
                )}
                {phoneTab === "profile" && (
                  <p>
                    {hud.username} ·{" "}
                    {wallet && wallet.nfts > 0
                      ? "COLLECTOR"
                      : hud.streetRep >= 40 ? "STREET KING" : hud.streetRep >= 15 ? "GETAWAY DRIVER" : hud.level >= 3 ? "UP-AND-COMER" : "FRESH OFF THE BUS"}
                    <br />
                    {hud.raceBestMs > 0 ? `Midnight Line best: ${(hud.raceBestMs / 1000).toFixed(1)}s` : "No race record yet."}
                    <br />
                    Guest until you connect. NFTs never drop on death.
                  </p>
                )}
              </section>
            </div>
          )}

          {walletOpen && (
            <WalletPanel session={session} onClose={() => setWalletOpen(false)} onVerified={(a) => void syncWalletAssets(a)} />
          )}
        </>
      )}

      <style jsx>{`
        .shell {
          position: fixed;
          inset: 0;
          overflow: hidden;
          background: #1b1614;
        }
        .view {
          display: block;
          width: 100%;
          height: 100%;
        }
        .gate {
          position: absolute;
          inset: auto 8vw 10vh 8vw;
          max-width: 520px;
          background: linear-gradient(180deg, rgba(28, 18, 14, 0.05), rgba(14, 9, 7, 0.78));
          padding: 28px 8px 8px;
          pointer-events: none;
        }
        .gate label,
        .gate input,
        .gate .enter {
          pointer-events: auto;
        }
        .kicker {
          letter-spacing: 0.28em;
          font-size: 11px;
          color: #c45a32;
          margin: 0 0 8px;
        }
        h1 {
          font-family: var(--font-display), Impact, sans-serif;
          font-size: clamp(56px, 10vw, 92px);
          line-height: 0.85;
          margin: 0 0 16px;
          letter-spacing: -0.03em;
        }
        .lede {
          color: #d8c4ae;
          max-width: 42ch;
          line-height: 1.45;
        }
        label {
          display: block;
          font-size: 11px;
          letter-spacing: 0.16em;
          color: #8a7564;
          margin: 18px 0 20px;
        }
        input {
          display: block;
          margin-top: 8px;
          width: min(280px, 80vw);
          background: #2a2018;
          border: 1px solid #6a4a38;
          color: #f3e6d2;
          padding: 10px 12px;
          font-size: 16px;
        }
        .enter {
          background: #c45a32;
          color: #1a1410;
          border: 0;
          padding: 14px 22px;
          font-weight: 800;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        .hint,
        .err {
          font-size: 12px;
          color: #8a7564;
          margin-top: 14px;
        }
        .err {
          color: #e07050;
        }
        .hud-tl {
          position: absolute;
          top: 18px;
          left: 18px;
          max-width: 46vw;
        }
        .obj {
          font-family: var(--font-display), sans-serif;
          font-size: 22px;
          letter-spacing: 0.04em;
        }
        .way {
          display: inline-block;
          margin-right: 8px;
          color: #f0b040;
          font-size: 16px;
          transition: transform 0.15s linear;
        }
        .assist {
          margin-top: 8px;
          font-size: 12px;
          color: #e6c39a;
          background: rgba(20, 12, 10, 0.55);
          padding: 6px 8px;
        }
        .hud-tr {
          position: absolute;
          top: 16px;
          right: 16px;
          text-align: right;
        }
        .cash {
          font-family: var(--font-display), sans-serif;
          font-size: 28px;
        }
        .heat {
          display: flex;
          gap: 4px;
          justify-content: flex-end;
          margin: 6px 0;
        }
        .heat span {
          width: 12px;
          height: 12px;
          background: #3a2a22;
          transform: rotate(45deg);
        }
        .heat span.on {
          background: #d8c4a0;
        }
        .heat.h3 span.on,
        .heat.h4 span.on,
        .heat.h5 span.on {
          background: #c45a32;
        }
        .heat.hot span.on {
          animation: pulse 0.6s ease-in-out infinite;
          box-shadow: 0 0 8px rgba(224, 80, 48, 0.9);
        }
        .vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(ellipse at center, transparent 52%, rgba(160, 24, 16, 0.42) 100%);
          animation: pulse 1.4s ease-in-out infinite;
          z-index: 2;
        }
        .xpbar {
          height: 3px;
          margin-top: 4px;
          background: #2a2018;
        }
        .xpbar i {
          display: block;
          height: 100%;
          background: #e0a030;
          transition: width 0.4s ease;
        }
        .bigmap {
          display: block;
          width: 100%;
          border: 1px solid #6a4a38;
          image-rendering: pixelated;
        }
        .legend {
          font-size: 10px;
          color: #8a7564;
          margin: 6px 0 0;
        }
        .radio {
          border: 1px solid #c45a32;
          background: #1a1410;
          color: #f3e6d2;
          padding: 6px 8px;
          font-size: 11px;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        .radio.dead {
          border-color: #e07050;
          animation: pulse 1.2s ease-in-out infinite;
        }
        .meta {
          font-size: 11px;
          color: #8a7564;
          margin-top: 6px;
        }
        .hud-br {
          position: absolute;
          right: 18px;
          bottom: 18px;
          width: 180px;
        }
        .bars {
          height: 10px;
          background: #2a2018;
          position: relative;
        }
        .bars i {
          position: absolute;
          left: 0;
          height: 5px;
        }
        .hp {
          top: 0;
          background: #c45a32;
        }
        .ar {
          bottom: 0;
          background: #8aa0b4;
        }
        .gun {
          font-size: 11px;
          margin-top: 6px;
          letter-spacing: 0.08em;
        }
        .prompt,
        .toast {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(18, 12, 10, 0.78);
          padding: 8px 14px;
          letter-spacing: 0.06em;
        }
        .prompt {
          bottom: 28%;
        }
        .toast {
          top: 22%;
          color: #e6c39a;
        }
        .news {
          position: absolute;
          top: 58px;
          left: 50%;
          transform: translateX(-50%);
          max-width: 80vw;
          background: rgba(196, 90, 50, 0.14);
          border: 1px solid rgba(196, 90, 50, 0.5);
          color: #e6c39a;
          padding: 6px 12px;
          font-size: 12px;
          letter-spacing: 0.06em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .loot {
          position: absolute;
          right: 18px;
          bottom: 96px;
          font-size: 11px;
          color: #e0a030;
          background: rgba(18, 12, 10, 0.72);
          padding: 5px 8px;
          letter-spacing: 0.06em;
        }
        .lockpick {
          position: absolute;
          left: 50%;
          top: 42%;
          transform: translate(-50%, -50%);
          width: min(420px, 84vw);
          background: rgba(14, 9, 7, 0.92);
          border: 1px solid #6a4a38;
          padding: 14px;
          touch-action: none;
        }
        .lockpick p {
          margin: 0 0 10px;
          font-size: 12px;
          letter-spacing: 0.08em;
          color: #d8c4ae;
        }
        .lockpick .track {
          position: relative;
          height: 22px;
          background: #2a2018;
        }
        .lockpick .zone {
          position: absolute;
          top: 0;
          bottom: 0;
          background: rgba(122, 168, 116, 0.55);
        }
        .lockpick .pin {
          position: absolute;
          top: -3px;
          bottom: -3px;
          width: 4px;
          margin-left: -2px;
          background: #f3e6d2;
        }
        .jail {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: min(380px, 86vw);
          background: rgba(10, 8, 12, 0.94);
          border: 1px solid #8aa0b4;
          padding: 20px;
          text-align: center;
          z-index: 8;
        }
        .jail h2 {
          font-family: var(--font-display), sans-serif;
          margin: 0 0 8px;
          letter-spacing: 0.1em;
        }
        .jail p {
          color: #d8c4ae;
          font-size: 13px;
        }
        .jail .fine {
          color: #8a7564;
          font-size: 11px;
        }
        .jail button {
          background: #c45a32;
          color: #1a1410;
          border: 0;
          padding: 10px 16px;
          font-weight: 800;
          letter-spacing: 0.08em;
          cursor: pointer;
          margin: 8px 0;
        }
        .pull {
          background: #c45a32;
          color: #1a1410;
          border: 0;
          padding: 8px 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        .bankrow {
          display: flex;
          gap: 6px;
          margin: 6px 0;
        }
        .bankrow button {
          background: #2a2018;
          color: #f3e6d2;
          border: 1px solid #6a4a38;
          padding: 6px 8px;
          font-size: 10px;
          cursor: pointer;
        }
        .talk {
          position: absolute;
          left: 18px;
          bottom: 118px;
          width: min(420px, 70vw);
          background: rgba(16, 10, 8, 0.86);
          border-left: 3px solid #c45a32;
          padding: 10px 12px;
        }
        .talk b {
          color: #c45a32;
        }
        .talk p {
          margin: 6px 0 0;
        }
        .dock {
          position: absolute;
          left: 50%;
          bottom: 16px;
          transform: translateX(-50%);
          display: flex;
          gap: 8px;
          z-index: 5;
        }
        .dock button {
          background: #2a2018;
          color: #f3e6d2;
          border: 1px solid #6a4a38;
          padding: 8px 10px;
          letter-spacing: 0.08em;
          font-size: 11px;
        }
        .menu-toggle {
          display: none;
        }
        .stick {
          position: absolute;
          width: 118px;
          height: 118px;
          border: 2px solid rgba(243, 230, 210, 0.28);
          border-radius: 50%;
          bottom: 28px;
          touch-action: none;
        }
        .stick.move {
          left: 22px;
        }
        .stick.aim {
          right: 22px;
          bottom: 150px;
        }
        .stick em {
          position: absolute;
          width: 42px;
          height: 42px;
          background: rgba(196, 90, 50, 0.85);
          border-radius: 50%;
          left: 36px;
          top: 36px;
        }
        .stick span {
          display: block;
          text-align: center;
          margin-top: 48px;
          font-size: 11px;
          letter-spacing: 0.12em;
        }
        .act {
          position: absolute;
          right: 36px;
          bottom: 36px;
          width: 64px;
          height: 64px;
          border-radius: 50%;
          border: 0;
          background: #c45a32;
          color: #1a1410;
          font-weight: 800;
          touch-action: none;
        }
        .jump {
          position: absolute;
          right: 116px;
          bottom: 30px;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: 1px solid rgba(243, 230, 210, 0.4);
          background: rgba(42, 32, 24, 0.85);
          color: #f3e6d2;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          touch-action: none;
        }
        .minimap {
          position: absolute;
          left: 16px;
          bottom: 16px;
          width: 132px;
          height: 132px;
          border: 1px solid rgba(243, 230, 210, 0.3);
          background: #241c16;
        }
        .crosshair {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 4px;
          height: 4px;
          margin: -2px 0 0 -2px;
          background: #f3e6d2;
          box-shadow: 0 0 0 1px rgba(26, 20, 16, 0.7);
          pointer-events: none;
        }
        .debug {
          position: absolute;
          left: 16px;
          top: 86px;
          background: rgba(16, 10, 8, 0.92);
          border: 1px dashed #8a7564;
          padding: 8px;
          font-size: 11px;
          z-index: 6;
        }
        .debug button {
          background: #2a2018;
          color: #f3e6d2;
          border: 1px solid #6a4a38;
          margin: 2px;
          padding: 3px 6px;
          font-size: 10px;
        }
        .phone {
          position: absolute;
          right: 18px;
          top: 86px;
          width: min(280px, 80vw);
          background: #1a1410;
          border: 1px solid #c45a32;
          padding: 10px;
        }
        .phone header {
          display: flex;
          justify-content: space-between;
          letter-spacing: 0.14em;
          font-size: 12px;
        }
        .phone nav {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin: 8px 0;
        }
        .phone nav button,
        .phone header button {
          background: #2a2018;
          color: #f3e6d2;
          border: 0;
          padding: 4px 6px;
        }
        .phone nav .on {
          background: #c45a32;
          color: #1a1410;
        }
        @keyframes pulse {
          50% {
            opacity: 0.55;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .stick,
          .act,
          .jump {
            display: none;
          }
        }
        /* Compact mobile layout: sticks own the bottom corners, so the
           minimap and status bars move up and everything respects notches. */
        @media (max-width: 899px) {
          .minimap {
            left: max(10px, env(safe-area-inset-left));
            bottom: auto;
            top: 128px;
            width: 88px;
            height: 88px;
          }
          .hud-tl {
            top: max(10px, env(safe-area-inset-top));
            left: max(12px, env(safe-area-inset-left));
            max-width: 52vw;
          }
          .obj {
            font-size: 16px;
          }
          .assist {
            font-size: 10px;
          }
          .hud-tr {
            top: max(10px, env(safe-area-inset-top));
            right: max(10px, env(safe-area-inset-right));
          }
          .cash {
            font-size: 20px;
          }
          .hud-br {
            right: max(10px, env(safe-area-inset-right));
            top: 138px;
            bottom: auto;
            width: 128px;
          }
          .dock {
            top: auto;
            bottom: max(6px, env(safe-area-inset-bottom));
            gap: 4px;
            max-width: 96vw;
            flex-wrap: wrap;
            justify-content: center;
          }
          .dock button {
            padding: 6px 6px;
            font-size: 9px;
            letter-spacing: 0.04em;
          }
          .menu-toggle {
            display: inline-block;
            background: #c45a32;
            color: #1a1410;
            font-weight: 800;
          }
          .dock:not(.open) button:not(.menu-toggle) {
            display: none;
          }
          .stick.move {
            left: max(16px, env(safe-area-inset-left));
            bottom: 64px;
          }
          .stick.aim {
            right: max(16px, env(safe-area-inset-right));
            bottom: 176px;
          }
          .act {
            right: max(30px, env(safe-area-inset-right));
            bottom: 96px;
          }
          .jump {
            right: max(110px, calc(env(safe-area-inset-right) + 104px));
            bottom: 90px;
          }
          .phone {
            left: 50%;
            right: auto;
            transform: translateX(-50%);
            width: min(320px, 92vw);
            max-height: calc(100vh - 130px);
            overflow-y: auto;
          }
          .prompt {
            bottom: 34%;
            font-size: 12px;
            max-width: 88vw;
            text-align: center;
          }
          .news {
            top: auto;
            bottom: 58px;
            font-size: 10px;
          }
          .loot {
            bottom: auto;
            top: 236px;
            right: max(10px, env(safe-area-inset-right));
          }
          .talk {
            bottom: 200px;
            width: min(320px, 62vw);
          }
          .gate {
            inset: auto 5vw 8vh 5vw;
          }
        }
      `}</style>
    </div>
  );
}
