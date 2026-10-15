import * as C from "./constants";
import { center, layer, locate, makeMaze } from "./maze";
import type {
  Art,
  Drifter,
  FathomState,
  Predator,
  ReadState,
  Screen,
  Snapshot,
} from "./types";

export const COUNTDOWN_TIME = 1.8;
export const CLEAR_TIME = 2;
export function copy(s: ReadState): FathomState {
  return {
    ...s,
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    tileMarks: [...s.tileMarks],
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    forager: { ...s.forager },
    drifters: s.drifters.map((d) => ({ ...d })),
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    pulses: s.pulses.map((p) => ({ ...p })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    start: { ...s.start },
    held: [...s.held],
    pointerPress: s.pointerPress ? { ...s.pointerPress } : null,
    art: Object.fromEntries(
      Object.entries(s.art).map(([name, frames]) => [name, [...frames]]),
    ),
  };
}
export function predator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
): Predator {
  return {
    ...center(tx, ty),
    dir: "up",
    kind,
    state: "wander",
    released: true,
    mind: true,
    travel: true,
    speed: kind === "lanternjaw" ? C.DRIFTER_SPEED : C.PREDATOR_SPEED,
    alert: false,
    lit: false,
    detectRange: kind === "gloamfin" ? null : C.LANTERN_RANGE_BASE,
    hearingRange: kind === "gloamfin" ? C.GLOAMFIN_HEAR : null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    markLeft: 0,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    pingGap: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flareTime: 0,
    flareFade: 0,
    releaseAt: null,
  };
}
export function roster(depth: number, tiles: readonly string[]): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  const den: { tx: number; ty: number }[] = [];
  tiles.forEach((r, ty) =>
    [...r].forEach((t, tx) => {
      if (t === "d") den.push({ tx, ty });
    }),
  );
  return kinds.map((kind, i) => {
    const pos = den[(i * 2) % Math.max(den.length, 1)] ?? { tx: 17, ty: 8 };
    return {
      ...predator(kind, pos.tx, pos.ty),
      state: "den",
      released: false,
      releaseAt: i * C.DEN_RELEASE_GAP,
    };
  });
}
export function drifter(tx: number, ty: number): Drifter {
  return { ...center(tx, ty), dir: "up", lit: false, mind: true, travel: true };
}
export function fresh(art: Art, muted = false): FathomState {
  const tiles = makeMaze(),
    start = { tx: 17, ty: 13 };
  return reconcileOwned({
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) =>
      [...r].map((t) => (t === "." ? "*" : "-")).join(""),
    ),
    visibility: layer("u"),
    tileMarks: Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(0),
    forager: { ...center(start.tx, start.ty), dir: "left", moving: false },
    drifters: [],
    predators: roster(1, tiles),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    accumulator: 0,
    desired: "left",
    held: [],
    sonarQueued: false,
    inkQueued: false,
    screenTime: 0,
    playTime: 0,
    rng: 0x9e3779b9,
    start,
    pointerPress: null,
    art,
  });
}
export function reconcileOwned(s: FathomState): FathomState {
  s.forager = locate(s.forager);
  s.drifters = s.drifters.map(locate);
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.reduce(
    (sum, r) => sum + [...r].filter((t) => t === "*").length,
    0,
  );
  s.predators = s.predators.map((p) => ({
    ...locate(p),
    speed:
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED,
    detectRange:
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness,
    hearingRange: p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null,
  }));
  return s;
}
export function enter(s: FathomState, screen: Screen): FathomState {
  const previous = s.screen;
  s.screen = screen;
  s.screenTime = 0;
  s.pointerPress = null;
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : screen === "paused" || screen === "gameover"
        ? 0
        : null;
  if (screen === "playing" && previous !== "paused" && previous !== "playing")
    s.playTime = 0;
  if (screen === "playing" && previous !== "playing") s.held = [];
  if (screen !== "playing") {
    s.sonarQueued = false;
    s.inkQueued = false;
  }
  return s;
}
/** A fresh run preserves session preferences and the title menu's memory. */
export function newRun(
  s: FathomState,
  screen: "title" | "countdown",
): FathomState {
  const next = fresh(s.art, s.muted);
  next.titleIndex = s.titleIndex;
  next.simTime = s.simTime;
  next.accumulator = s.accumulator;
  return enter(next, screen);
}
export function nextDepth(s: FathomState): FathomState {
  const next = newRun(s, "countdown");
  next.score = s.score;
  next.lives = s.lives;
  next.depth = s.depth + 1;
  next.predators = roster(next.depth, next.tiles);
  return reconcileOwned(next);
}
export function retry(s: FathomState): FathomState {
  s.lives--;
  s.forager = { ...center(s.start.tx, s.start.ty), dir: "left", moving: false };
  s.desired = "left";
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth, s.tiles);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.pulses = [];
  s.inkClouds = [];
  s.tileMarks.fill(0);
  s.visibility = s.visibility.map((r) => r.replace(/l/g, "r"));
  return enter(reconcileOwned(s), "countdown");
}
export function random(s: FathomState): number {
  let x = s.rng;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 0x100000000;
}
export function gate(s: ReadState): { tx: number; ty: number } | null {
  for (let ty = 0; ty < s.tiles.length; ty++) {
    const tx = s.tiles[ty]!.indexOf("g");
    if (tx >= 0) return { tx, ty };
  }
  return null;
}
export function hasDen(s: ReadState): boolean {
  return gate(s) !== null && s.tiles.some((r) => r.includes("d"));
}
export function snapshot(state: ReadState): Snapshot {
  const s = reconcileOwned(copy(state));
  const {
    version,
    screen,
    menuIndex,
    titleIndex,
    depth,
    score,
    lives,
    muted,
    planktonRemaining,
    drifterIn,
    brightness,
    brightHold,
    visionRadius,
    windowRadius,
    sonar,
    ink,
    grid,
    tiles,
    plankton,
    visibility,
    forager,
    inkClouds,
    simTime,
  } = s;
  return {
    version,
    screen,
    menuIndex,
    titleIndex,
    depth,
    score,
    lives,
    muted,
    planktonRemaining,
    drifterIn,
    brightness,
    brightHold,
    visionRadius,
    windowRadius,
    sonar,
    ink,
    grid,
    tiles,
    plankton,
    visibility,
    forager,
    inkClouds,
    simTime,
    drifters: s.drifters.map(({ x, y, tx, ty, lit, mind, travel }) => ({
      x,
      y,
      tx,
      ty,
      lit,
      mind,
      travel,
    })),
    predators: s.predators.map(
      ({
        kind,
        x,
        y,
        tx,
        ty,
        dir,
        state,
        released,
        mind,
        travel,
        speed,
        alert,
        lit,
        detectRange,
        hearingRange,
        hearingLock,
        flareCharging,
        flaring,
        flareRadius,
      }) => ({
        kind,
        x,
        y,
        tx,
        ty,
        dir,
        state,
        released,
        mind,
        travel,
        speed,
        alert,
        lit,
        detectRange,
        hearingRange,
        hearingLock,
        flareCharging,
        flaring,
        flareRadius,
      }),
    ),
    pulses: s.pulses.map(({ source, tint, ox, oy, front, range }) => ({
      source,
      tint,
      ox,
      oy,
      front,
      range,
    })),
  };
}
export function isLoose(
  _s: ReadState,
  p: ReadState["predators"][number],
): boolean {
  return p.state !== "den";
}
