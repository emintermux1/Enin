export type StationId = "nova-fm" | "palm" | "under88" | "off";

export interface AudioLevels {
  master: number;
  music: number;
  radio: number;
  sfx: number;
  ui: number;
}

const NOTE: Record<string, number> = {
  C2: 65.41,
  D2: 73.42,
  E2: 82.41,
  F2: 87.31,
  G2: 98.0,
  A2: 110.0,
  Bb2: 116.54,
  C3: 130.81,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  G3: 196.0,
  A3: 220.0,
  Bb3: 233.08,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  Bb4: 466.16,
  C5: 523.25,
};

interface Pattern {
  bpm: number;
  bass: Array<string | null>;
  lead: Array<string | null>;
  pad: Array<string | null>;
  kick: boolean[];
  snare: boolean[];
  hat: boolean[];
}

const NOVA: Pattern = {
  bpm: 98,
  bass: ["A2", null, "A2", null, "F2", null, "F2", "C3", "C3", null, "G2", null, "G2", "A2", null, "E2"],
  lead: ["A4", null, "C5", "A4", null, "G4", "E4", null, "F4", null, "E4", "D4", null, "C4", "E4", null],
  pad: ["A3", "A3", "A3", "A3", "F3", "F3", "F3", "F3", "C4", "C4", "C4", "C4", "G3", "G3", "G3", "G3"],
  kick: [true, false, false, true, true, false, false, false, true, false, true, false, true, false, false, false],
  snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, true],
  hat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
};

const PALM: Pattern = {
  bpm: 104,
  bass: ["C2", null, "E2", null, "G2", null, "E2", null, "A2", null, "G2", null, "F2", "E2", null, "C2"],
  lead: ["E4", "G4", null, "A4", null, "G4", "E4", null, "C5", null, "A4", "G4", null, "E4", "D4", null],
  pad: ["C3", "C3", "E3", "E3", "G3", "G3", "E3", "E3", "A3", "A3", "G3", "G3", "F3", "F3", "E3", "C3"],
  kick: [true, false, false, false, true, false, true, false, true, false, false, false, true, false, false, false],
  snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
  hat: [true, false, true, false, true, false, true, true, true, false, true, false, true, false, true, false],
};

const UNDER: Pattern = {
  bpm: 86,
  bass: ["A2", "A2", null, "A2", "G2", null, "F2", "F2", null, "F2", "E2", null, "A2", null, "C3", "A2"],
  lead: [null, "A3", null, "C4", null, "A3", "G3", null, null, "F3", null, "E3", null, "A3", null, null],
  pad: ["A2", "A2", "A2", "A2", "F2", "F2", "F2", "F2", "D3", "D3", "D3", "D3", "E3", "E3", "A2", "A2"],
  kick: [true, false, false, false, false, false, true, false, true, false, false, false, false, true, false, false],
  snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
  hat: [false, true, false, true, false, true, false, true, false, true, false, true, false, true, true, true],
};

export class GameAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  sfxGain: GainNode | null = null;
  station: StationId = "nova-fm";
  inVehicle = false;
  venue = false;
  unlocked = false;
  private timer: number | null = null;
  private step = 0;
  private levels: AudioLevels = { master: 1, music: 0.42, radio: 0.5, sfx: 0.7, ui: 0.55 };
  private engine: { osc: OscillatorNode; filt: BiquadFilterNode; gain: GainNode } | null = null;
  private siren: { a: OscillatorNode; b: OscillatorNode; gain: GainNode; t: number } | null = null;
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  lastError = "";

  get playing(): boolean {
    return this.unlocked && this.station !== "off" && Boolean(this.ctx);
  }

  stationLabel(): string {
    switch (this.station) {
      case "nova-fm":
        return "NOVA FM";
      case "palm":
        return "PALM RADIO";
      case "under88":
        return "UNDERGROUND 88";
      case "off":
        return "RADIO OFF";
      default: {
        const _n: never = this.station;
        return _n;
      }
    }
  }

  async unlock(): Promise<boolean> {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (!this.master) {
        this.master = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.musicGain.connect(this.master);
        this.sfxGain.connect(this.master);
        this.master.connect(this.ctx.destination);
        this.applyLevels();
        this.startAmbience();
        this.startEngine();
      }
      this.unlocked = true;
      this.lastError = "";
      this.ensureSequencer();
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "audio failed";
      this.unlocked = false;
      return false;
    }
  }

  setLevels(levels: Partial<AudioLevels>): void {
    this.levels = { ...this.levels, ...levels };
    this.applyLevels();
  }

  setStation(id: StationId): void {
    this.station = id;
    this.step = 0;
  }

  cycleStation(): void {
    const order: StationId[] = ["nova-fm", "palm", "under88", "off"];
    const i = order.indexOf(this.station);
    this.setStation(order[(i + 1) % order.length] ?? "nova-fm");
  }

  setInVehicle(v: boolean): void {
    this.inVehicle = v;
    this.applyLevels();
  }

  /** Inside a club the house system is the loudest thing in the room. */
  setVenue(on: boolean): void {
    this.venue = on;
    this.applyLevels();
  }

  setEngineSpeed(speed: number, on: boolean): void {
    if (!this.engine || !this.ctx) return;
    this.engine.gain.gain.setTargetAtTime(on ? Math.min(0.08, 0.02 + speed * 0.00025) : 0, this.ctx.currentTime, 0.08);
    this.engine.osc.frequency.setTargetAtTime(48 + speed * 1.15, this.ctx.currentTime, 0.06);
    this.engine.filt.frequency.setTargetAtTime(220 + speed * 8, this.ctx.currentTime, 0.08);
  }

  setSiren(on: boolean): void {
    if (!this.ctx || !this.sfxGain) return;
    if (on && !this.siren) {
      const a = this.ctx.createOscillator();
      const b = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      a.type = "sawtooth";
      b.type = "sawtooth";
      a.frequency.value = 620;
      b.frequency.value = 820;
      g.gain.value = 0.04;
      a.connect(g);
      b.connect(g);
      g.connect(this.sfxGain);
      a.start();
      b.start();
      this.siren = { a, b, gain: g, t: 0 };
    }
    if (!on && this.siren) {
      this.siren.a.stop();
      this.siren.b.stop();
      this.siren = null;
    }
  }

  tickSiren(dt: number): void {
    if (!this.siren || !this.ctx) return;
    this.siren.t += dt;
    const high = Math.sin(this.siren.t * 3.2) > 0;
    this.siren.a.frequency.setTargetAtTime(high ? 680 : 520, this.ctx.currentTime, 0.05);
    this.siren.b.frequency.setTargetAtTime(high ? 900 : 700, this.ctx.currentTime, 0.05);
  }

  /** Positional siren: gain falls off with distance to the nearest unit. */
  setSirenDistance(distance: number): void {
    if (!this.siren || !this.ctx) return;
    const gain = 0.055 * Math.max(0.08, Math.min(1, 1 - distance / 900));
    this.siren.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.15);
  }

  gun(): void {
    this.noiseBurst(0.07, 1800, 0.18);
    this.beep(140, 0.04, "square", 0.08);
  }

  explosion(): void {
    this.noiseBurst(0.45, 400, 0.55);
    this.beep(70, 0.3, "sawtooth", 0.16);
  }

  uiClick(): void {
    this.beep(880, 0.04, "square", 0.04 * this.levels.ui);
  }

  foot(sprint: boolean, surface: "concrete" | "grass" | "sand" | "metal" = "concrete"): void {
    const base = surface === "metal" ? 230 : surface === "grass" ? 120 : surface === "sand" ? 95 : 150;
    const type = surface === "metal" ? "square" : "triangle";
    this.beep(sprint ? base * 1.25 : base, surface === "sand" ? 0.05 : 0.03, type, surface === "grass" ? 0.02 : 0.03);
  }

  alarm(): void {
    this.beep(1200, 0.12, "square", 0.08);
    this.beep(900, 0.12, "square", 0.08);
  }

  cash(): void {
    this.beep(660, 0.06, "square", 0.06);
    this.beep(880, 0.08, "square", 0.05);
  }

  wanted(): void {
    this.beep(520, 0.12, "sawtooth", 0.07);
    this.beep(390, 0.14, "sawtooth", 0.06);
  }

  private applyLevels(): void {
    if (!this.master || !this.musicGain || !this.sfxGain) return;
    this.master.gain.value = this.levels.master;
    const onFoot = this.venue ? this.levels.radio : this.levels.music;
    const music = this.station === "off" ? 0 : this.inVehicle ? this.levels.radio : onFoot;
    this.musicGain.gain.value = music * (this.inVehicle ? 0.95 : this.venue ? 1.05 : 0.72);
    this.sfxGain.gain.value = this.levels.sfx;
  }

  private ensureSequencer(): void {
    if (this.timer !== null) return;
    const pulse = (): void => {
      const pat = this.pattern();
      const stepMs = (60 / pat.bpm / 4) * 1000;
      this.timer = window.setTimeout(() => {
        this.playStep();
        this.timer = null;
        if (this.unlocked) pulse();
      }, stepMs);
    };
    pulse();
  }

  private pattern(): Pattern {
    if (this.station === "palm") return PALM;
    if (this.station === "under88") return UNDER;
    return NOVA;
  }

  private playStep(): void {
    if (!this.ctx || !this.musicGain || this.station === "off") {
      this.step = (this.step + 1) % 16;
      return;
    }
    const pat = this.pattern();
    const i = this.step % 16;
    const t = this.ctx.currentTime;
    if (pat.kick[i]) this.drum(t, 0.16, 90, 0.22);
    if (pat.snare[i]) this.noiseBurst(0.09, 1800, 0.1);
    if (pat.hat[i]) this.noiseBurst(0.02, 7000, 0.03);
    const bass = pat.bass[i];
    if (bass) this.tone(NOTE[bass] ?? 110, 0.22, "sawtooth", 0.07, 180);
    const lead = pat.lead[i];
    if (lead) this.tone(NOTE[lead] ?? 440, 0.16, "square", 0.035, 1400);
    const pad = pat.pad[i];
    if (pad) this.tone(NOTE[pad] ?? 220, 0.28, "triangle", 0.02, 600);
    this.step += 1;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, cutoff: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = freq;
    f.type = "lowpass";
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    osc.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    osc.start();
    osc.stop(this.ctx.currentTime + dur + 0.02);
  }

  private drum(t: number, dur: number, freq: number, vol: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private beep(freq: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start();
    osc.stop(this.ctx.currentTime + dur + 0.02);
  }

  private noiseBurst(dur: number, cutoff: number, vol: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start();
  }

  private startAmbience(): void {
    if (!this.ctx || !this.sfxGain || this.ambience) return;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start();
    this.ambience = { src, gain: g };
  }

  private startEngine(): void {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const filt = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 50;
    filt.type = "lowpass";
    filt.frequency.value = 240;
    gain.gain.value = 0;
    osc.connect(filt);
    filt.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    this.engine = { osc, filt, gain };
  }
}
