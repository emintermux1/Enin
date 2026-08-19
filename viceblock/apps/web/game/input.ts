import {
  beginStick,
  idleStick,
  moveStick,
  releaseStick,
  shouldIgnoreStickEvent,
  type StickState,
} from "@viceblock/game-core";

export class GameInput {
  keys = new Set<string>();
  mx = 0;
  my = 0;
  aimX = 0;
  aimY = 0;
  fire = false;
  interact = false;
  interactQueued = false;
  phoneQueued = false;
  radioQueued = false;
  assistQueued = false;
  surrenderQueued = false;
  pointerLocked = false;
  stick: StickState = idleStick();
  aimStick: StickState = idleStick();
  mobile = false;
  gamepadOn = false;
  private padFire = false;
  private padButtons = new Set<number>();

  attach(canvas: HTMLCanvasElement): () => void {
    this.mobile = matchMedia("(pointer: coarse)").matches || window.innerWidth < 820;
    const down = (e: KeyboardEvent): void => {
      if (e.repeat && (e.code === "KeyE" || e.code === "KeyF" || e.code === "KeyR")) return;
      this.keys.add(e.code);
      if (e.code === "KeyE") this.interactQueued = true;
      if (e.code === "KeyF" || e.code === "Tab") {
        e.preventDefault();
        this.phoneQueued = true;
      }
      if (e.code === "KeyR") this.radioQueued = true;
      if (e.code === "KeyH") this.assistQueued = true;
      if (e.code === "KeyG") this.surrenderQueued = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent): void => {
      this.keys.delete(e.code);
    };
    const md = (e: PointerEvent): void => {
      // Touch on the canvas orbits the camera; anything else (mouse, pen,
      // synthetic events with an empty pointerType) fires on button 0.
      if (e.pointerType !== "touch" && e.button === 0) this.fire = true;
      this.pointerLocked = true;
    };
    const mu = (e: PointerEvent): void => {
      // Guarded by pointer type so lifting a touch (e.g. the move stick)
      // doesn't cancel fire held by the aim stick.
      if (e.pointerType !== "touch" && e.button === 0) this.fire = false;
    };
    const move = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      this.mx = e.clientX - rect.left;
      this.my = e.clientY - rect.top;
    };
    const blur = (): void => this.resetAll();
    const vis = (): void => {
      if (document.hidden) this.resetAll();
    };
    const cancel = (): void => this.resetAll();
    const paste = (e: ClipboardEvent): void => {
      e.preventDefault();
    };

    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    canvas.addEventListener("pointerdown", md);
    window.addEventListener("pointerup", mu);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("lostpointercapture", cancel);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("paste", paste, true);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      canvas.removeEventListener("pointerdown", md);
      window.removeEventListener("pointerup", mu);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("lostpointercapture", cancel);
      canvas.removeEventListener("pointermove", move);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("paste", paste, true);
    };
  }

  resetAll(): void {
    this.keys.clear();
    this.fire = false;
    this.stick = releaseStick(this.stick);
    this.aimStick = releaseStick(this.aimStick);
  }

  /**
   * Polls the first connected gamepad (Xbox / PlayStation layouts share this
   * standard mapping): left stick moves, RT/R2 fires, A/Cross interacts,
   * Y/Triangle toggles the phone, RB/R1 cycles the radio.
   */
  pollGamepad(): { x: number; y: number; sprint: boolean } | null {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads.find?.((p) => p && p.connected) ?? null;
    if (!pad) {
      if (this.gamepadOn) {
        this.gamepadOn = false;
        this.padFire = false;
      }
      return null;
    }
    this.gamepadOn = true;
    const dead = (v: number): number => (Math.abs(v) < 0.14 ? 0 : v);
    const x = dead(pad.axes[0] ?? 0);
    const y = dead(pad.axes[1] ?? 0);
    this.padFire = (pad.buttons[7]?.value ?? 0) > 0.5;
    const edge = (idx: number): boolean => {
      const pressed = Boolean(pad.buttons[idx]?.pressed);
      const was = this.padButtons.has(idx);
      if (pressed && !was) {
        this.padButtons.add(idx);
        return true;
      }
      if (!pressed) this.padButtons.delete(idx);
      return false;
    };
    if (edge(0)) this.interactQueued = true;
    if (edge(3)) this.phoneQueued = true;
    if (edge(5)) this.radioQueued = true;
    if (Math.hypot(x, y) < 0.02) return null;
    return { x, y, sprint: Math.hypot(x, y) > 0.85 };
  }

  axis(): { x: number; y: number; sprint: boolean } {
    if (this.stick.active) {
      return {
        x: this.stick.dx,
        y: this.stick.dy,
        sprint: Math.hypot(this.stick.dx, this.stick.dy) > 0.72 || this.keys.has("ShiftLeft"),
      };
    }
    const pad = this.pollGamepad();
    if (pad) return pad;
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    return { x, y, sprint: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") };
  }

  firing(): boolean {
    return this.fire || this.padFire;
  }

  consumeInteract(): boolean {
    if (this.interactQueued) {
      this.interactQueued = false;
      return true;
    }
    return false;
  }

  beginMoveStick(id: number, x: number, y: number): void {
    this.stick = beginStick(id, x, y);
  }

  moveMoveStick(id: number, x: number, y: number): void {
    if (shouldIgnoreStickEvent(this.stick, id)) return;
    this.stick = moveStick(this.stick, id, x, y, 58);
  }

  endMoveStick(id: number): void {
    if (this.stick.pointerId === id || this.stick.pointerId === null) this.stick = releaseStick(this.stick);
  }

  beginAimStick(id: number, x: number, y: number): void {
    this.aimStick = beginStick(id, x, y);
    this.fire = true;
  }

  moveAimStick(id: number, x: number, y: number): void {
    if (shouldIgnoreStickEvent(this.aimStick, id)) return;
    this.aimStick = moveStick(this.aimStick, id, x, y, 52);
  }

  endAimStick(id: number): void {
    if (this.aimStick.pointerId === id || this.aimStick.pointerId === null) {
      this.aimStick = releaseStick(this.aimStick);
      this.fire = false;
    }
  }
}
