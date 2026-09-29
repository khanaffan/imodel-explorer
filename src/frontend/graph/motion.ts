import type { Point, Positions } from "./layout";

export const DEFAULT_DURATION_MS = 480;
export const LEAVE_DURATION_MS = 220;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function lerpPositions(from: Positions, to: Positions, t: number): Positions {
  const e = easeInOutCubic(Math.min(1, Math.max(0, t)));
  const out: Positions = new Map();
  for (const [k, b] of to) {
    const a = from.get(k) ?? b;
    out.set(k, { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });
  }
  return out;
}

export interface Scheduler {
  now(): number;
  request(cb: () => void): number;
  cancel(handle: number): void;
}

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h),
};

/** Interpolates node positions between layouts on animation frames. Starting a new animation
 * mid-flight begins from wherever nodes currently are, so rapid clicks never jump. New nodes grow
 * out of `spawnOrigin` (typically the neighbour that introduced them). */
export class LayoutAnimator {
  private _current: Positions = new Map();
  private _handle?: number;

  public constructor(
    private readonly _onFrame: (positions: Positions, done: boolean) => void,
    private readonly _scheduler: Scheduler = browserScheduler,
  ) { }

  public get current(): Positions { return this._current; }
  public get running(): boolean { return this._handle !== undefined; }

  public animateTo(target: Positions, spawnOrigin: (key: string) => Point | undefined, duration = DEFAULT_DURATION_MS): void {
    this.stop();
    const from: Positions = new Map();
    for (const [k, p] of target)
      from.set(k, this._current.get(k) ?? spawnOrigin(k) ?? p);

    if (duration <= 0 || prefersReducedMotion()) {
      this._current = new Map(target);
      this._onFrame(this._current, true);
      return;
    }
    const start = this._scheduler.now();
    const step = () => {
      const t = (this._scheduler.now() - start) / duration;
      const done = t >= 1;
      this._current = done ? new Map(target) : lerpPositions(from, target, t);
      this._handle = done ? undefined : this._scheduler.request(step);
      this._onFrame(this._current, done);
    };
    this._handle = this._scheduler.request(step);
  }

  /** Moves one node immediately (drag) without disturbing an animation of the others. */
  public setPosition(key: string, p: Point): void {
    this._current = new Map(this._current).set(key, p);
  }

  public stop(): void {
    if (this._handle !== undefined) {
      this._scheduler.cancel(this._handle);
      this._handle = undefined;
    }
  }
}
