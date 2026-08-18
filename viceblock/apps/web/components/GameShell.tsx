"use client";

import { sanitizeText } from "@viceblock/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ViceblockRuntime, type HudSnapshot } from "../game/runtime";
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
};

export function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<ViceblockRuntime | null>(null);
  const sessionRef = useRef("");
  const [hud, setHud] = useState<HudSnapshot>(EMPTY);
  const [started, setStarted] = useState(false);
  const [bootError, setBootError] = useState("");
  const [name, setName] = useState("rookie");
  const [phoneTab, setPhoneTab] = useState<"map" | "jobs" | "crew" | "bank" | "profile">("jobs");
  const [walletOpen, setWalletOpen] = useState(false);
  const [session, setSession] = useState<string>("");

  const resize = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.floor(window.innerWidth * dpr);
    c.height = Math.floor(window.innerHeight * dpr);
    c.style.width = `${window.innerWidth}px`;
    c.style.height = `${window.innerHeight}px`;
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
    const game = new ViceblockRuntime(c);
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
      });
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
        y: g.player.y,
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
          <p className="kicker">SEASON 1 — WELCOME TO NOVA</p>
          <h1>VICEBLOCK</h1>
          <p className="lede">
            Southside is already awake. Guest in, walk, steal a Sparrow, hit Coral Mart, lose the slow cops.
            Music starts the second you enter. Wallet later.
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
          <p className="hint">WASD walk · Shift sprint · E interact · click shoot · R radio · F phone · H assist</p>
          {bootError ? <p className="err">{sanitizeText(bootError, 80)}</p> : null}
        </div>
      )}

      {started && (
        <>
          <div className="hud-tl">
            <div className="obj">{hud.objective}</div>
            {hud.assist ? <div className="assist">{hud.assist}</div> : null}
          </div>
          <div className="hud-tr">
            <div className="cash">${hud.cash}</div>
            <div className={`heat h${hud.heat}`}>
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
              {hud.dayLabel} · {hud.weather} · {hud.others} nearby
            </div>
          </div>
          <div className="hud-br">
            <div className="bars">
              <i className="hp" style={{ width: `${hud.health}%` }} />
              <i className="ar" style={{ width: `${hud.armor}%` }} />
            </div>
            <div className="gun">{hud.inVehicle ? `RIDE ${hud.vehicleHp}%` : "PISTOL / FISTS"}</div>
          </div>
          {hud.prompt ? <div className="prompt">{hud.prompt}</div> : null}
          {hud.toast ? <div className="toast">{hud.toast}</div> : null}
          {hud.dialogue ? (
            <div className="talk">
              <b>{hud.dialogue.who}</b>
              <p>{hud.dialogue.line}</p>
            </div>
          ) : null}

          <div className="dock">
            <button type="button" onClick={() => gameRef.current && (gameRef.current.player.phone = !gameRef.current.player.phone)}>
              PHONE
            </button>
            <button type="button" onClick={() => setWalletOpen((v) => !v)}>
              CONNECT WALLET
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
          </div>

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
              if (g) g.input.interactQueued = true;
            }}
          >
            E
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
                  <p>
                    Active: {hud.objective}
                    <br />
                    Street Rep {hud.streetRep} · LV {hud.level}
                  </p>
                )}
                {phoneTab === "map" && <p>Southside grid. Yellow jobs. Blue cops. Hide in alleys and Maya&apos;s.</p>}
                {phoneTab === "crew" && <p>Crews unlock after Port Authority. Cupsey already thinks you&apos;re late.</p>}
                {phoneTab === "bank" && (
                  <p>
                    Pocket ${hud.cash}
                    <br />
                    Vault ${hud.bank} — banked cash survives a bust
                  </p>
                )}
                {phoneTab === "profile" && (
                  <p>
                    {hud.username}
                    <br />
                    Guest until you connect. NFTs never drop on death.
                  </p>
                )}
              </section>
            </div>
          )}

          {walletOpen && <WalletPanel session={session} onClose={() => setWalletOpen(false)} />}
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
          inset: auto 8vw 12vh 8vw;
          max-width: 520px;
          background: linear-gradient(180deg, rgba(28, 18, 14, 0.2), rgba(18, 12, 10, 0.88));
          padding: 28px 8px 8px;
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
        }
        .dock button {
          background: #2a2018;
          color: #f3e6d2;
          border: 1px solid #6a4a38;
          padding: 8px 10px;
          letter-spacing: 0.08em;
          font-size: 11px;
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
        @media (min-width: 900px) {
          .stick,
          .act {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
