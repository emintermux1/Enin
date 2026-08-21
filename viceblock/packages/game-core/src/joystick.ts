export interface StickState {
  active: boolean;
  pointerId: number | null;
  originX: number;
  originY: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export function idleStick(): StickState {
  return {
    active: false,
    pointerId: null,
    originX: 0,
    originY: 0,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
  };
}

/** Always zero the stick — pointerup can be lost on mobile. */
export function releaseStick(_prev?: StickState): StickState {
  return idleStick();
}

export function beginStick(pointerId: number, x: number, y: number): StickState {
  return {
    active: true,
    pointerId,
    originX: x,
    originY: y,
    x,
    y,
    dx: 0,
    dy: 0,
  };
}

export function moveStick(state: StickState, pointerId: number, x: number, y: number, radius: number): StickState {
  if (!state.active || state.pointerId !== pointerId) return state;
  const ox = x - state.originX;
  const oy = y - state.originY;
  const mag = Math.hypot(ox, oy);
  const dead = 10;
  if (mag < dead) {
    return { ...state, x, y, dx: 0, dy: 0 };
  }
  const clamped = Math.min(mag, radius);
  const nx = (ox / mag) * (clamped / radius);
  const ny = (oy / mag) * (clamped / radius);
  return { ...state, x, y, dx: nx, dy: ny };
}

export function shouldIgnoreStickEvent(state: StickState, pointerId: number): boolean {
  return state.active && state.pointerId !== null && state.pointerId !== pointerId;
}
