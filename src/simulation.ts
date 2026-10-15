import * as C from "./constants";
import {
  atCenter,
  center,
  DIRECTIONS,
  distance,
  distances,
  exits,
  lineClear,
  move,
  neighbor,
  OPPOSITE,
  put,
  route,
  sameTile,
  segmentDistance,
  tile,
} from "./maze";
import {
  COUNTDOWN_TIME,
  CLEAR_TIME,
  drifter,
  enter,
  gate,
  hasDen,
  isLoose,
  nextDepth,
  random,
  reconcileOwned,
  retry,
} from "./world";
import type {
  Body,
  Direction,
  FathomState,
  Predator,
  Pulse,
  ReadState,
  TilePoint,
} from "./types";

export type CueSink = Set<C.CueName>;
const down = (time: number, dt = C.TICK_DT) =>
  Math.max(0, time - dt < 1e-9 ? 0 : time - dt);
function wander(s: FathomState, b: Body): Direction | null {
  const options = exits(s, b),
    forward = options.filter((d) => d !== OPPOSITE[b.dir]);
  const choices = forward.length ? forward : options;
  return choices.length
    ? choices[Math.floor(random(s) * choices.length)]!
    : null;
}
function acquire(
  s: FathomState,
  p: Predator,
  fix: TilePoint,
  fresh = false,
): void {
  if (p.state !== "chase" || fresh) {
    if (p.kind !== "lanternjaw") {
      p.alertLeft = C.ALERT_TIME;
      p.alert = true;
    }
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    const dir = route(s, p, fix);
    if (dir === OPPOSITE[p.dir]) p.dir = dir;
  }
  p.state = "chase";
  p.fix = { tx: fix.tx, ty: fix.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") endFlare(p);
}
function endFlare(p: Predator): void {
  if (p.flaring) p.flareFade = 0.35;
  p.flareCharging = false;
  p.flaring = false;
  p.flareRadius = 0;
  p.flareTime = 0;
  p.flareIn = C.FLARE_INTERVAL;
}
function drop(p: Predator): void {
  const wasChase = p.state === "chase";
  p.state = "wander";
  p.fix = null;
  p.linger = 0;
  if (p.kind === "flarefish" && wasChase) endFlare(p);
}
export function blinded(s: ReadState, p: { x: number; y: number }): boolean {
  return s.inkClouds.some((c) => segmentDistance(c, p, s.forager) <= c.radius);
}
function pulse(
  s: FathomState,
  p: Predator,
  owner: number,
  tint: "violet" | "orange",
  cues: CueSink,
): void {
  s.pulses.push({
    source: "gloamfin",
    tint,
    ox: p.tx,
    oy: p.ty,
    front: 0,
    range: C.GLOAMFIN_PING_RANGE,
    owner,
    caught: false,
  });
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.pingGap = 0;
  cues.add(C.CUES.predatorPing);
}
function lightMind(s: FathomState, p: Predator, cues: CueSink): void {
  const previous = p.state;
  const blocked = blinded(s, p);
  const sensed =
    !blocked &&
    distance(p, s.forager) <=
      C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness &&
    lineClear(s, p, s.forager);
  if (blocked) drop(p);
  else if (sensed || (p.flaring && distance(p, s.forager) <= C.FLARE_RADIUS))
    acquire(s, p, s.forager);
  else if (p.state === "chase") {
    p.linger = down(p.linger);
    if (!p.linger) drop(p);
  }
  if (p.kind !== "flarefish" || p.state !== "wander") return;
  // Returning to wander arms a whole interval, beginning with the next tick.
  if (previous === "chase") return;
  if (p.flareCharging || p.flaring) {
    p.flareTime += C.TICK_DT;
    if (p.flareCharging && p.flareTime + 1e-9 >= C.FLARE_CHARGE) {
      p.flareCharging = false;
      p.flaring = true;
      p.flareRadius = C.FLARE_RADIUS;
      p.flareTime = 0;
      cues.add(C.CUES.flare);
      // A bloom's first tick is a sensing tick too, even through rock.
      if (!blocked && distance(p, s.forager) <= C.FLARE_RADIUS)
        acquire(s, p, s.forager);
    } else if (p.flaring && p.flareTime + 1e-9 >= C.FLARE_BLOOM) endFlare(p);
  } else {
    p.flareIn = down(p.flareIn);
    if (!p.flareIn) {
      p.flareCharging = true;
      p.flareTime = 0;
    }
  }
}
function soundMind(
  s: FathomState,
  p: Predator,
  index: number,
  cues: CueSink,
): void {
  const wasHearing = p.hearingLock;
  p.hearingLock = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
  if (p.hearingLock) acquire(s, p, s.forager);
  p.chaseSpeed = Math.min(
    C.GLOAMFIN_CHASE_SPEED,
    p.chaseSpeed +
      ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
        C.GLOAMFIN_RAMP_TIME,
  );
  p.pingIn = down(p.pingIn);
  if (wasHearing && !p.hearingLock) p.pingIn = 0;
  p.pingGap += C.TICK_DT;
  if (
    p.state === "chase" &&
    p.fix &&
    sameTile(p, p.fix) &&
    atCenter(p) &&
    !sameTile(p, s.forager)
  ) {
    p.state = "search";
    p.searchTime = 0;
    p.searchPing = false;
  }
  if (p.state === "search") {
    p.searchTime += C.TICK_DT;
    if (p.searchTime + 1e-9 >= C.GLOAMFIN_GIVEUP) drop(p);
  }
  if (!p.hearingLock && p.pingGap + 1e-9 >= C.GLOAMFIN_PING_MIN_GAP) {
    if (
      p.state === "search" &&
      !p.searchPing &&
      p.searchTime + 1e-9 >= C.GLOAMFIN_SEARCH_DELAY
    ) {
      pulse(s, p, index, "orange", cues);
      p.searchPing = true;
    } else if (p.pingIn === 0 || wasHearing) pulse(s, p, index, "violet", cues);
  }
}
function travelPredator(s: FathomState, p: Predator): Predator {
  if (!p.travel) return p;
  const previousDir = p.dir;
  const choose = (b: Predator): Direction | null => {
    let dir: Direction | null;
    if (b.state === "den") {
      const g = gate(s);
      if (!g) return null;
      const targets = DIRECTIONS.map((d) => neighbor(s, g.tx, g.ty, d)).filter(
        (n) => tile(s, n.tx, n.ty) === ".",
      );
      dir = targets[0] ? route(s, b, targets[0], true) : null;
    } else if (b.state === "chase" && b.fix) dir = route(s, b, b.fix);
    else if (b.state === "search" && b.fix) {
      const map = distances(s, b.fix);
      const options = exits(s, b).filter((d) => {
        const n = neighbor(s, b.tx, b.ty, d);
        return map[n.ty * C.GRID_COLS + n.tx]! <= C.GLOAMFIN_SEARCH_ROAM;
      });
      const noReverse = options.filter((d) => d !== OPPOSITE[b.dir]);
      const choices = noReverse.length ? noReverse : options;
      dir = choices.length
        ? choices[Math.floor(random(s) * choices.length)]!
        : route(s, b, b.fix);
    } else dir = wander(s, b);
    if (
      p.kind === "gloamfin" &&
      p.state === "chase" &&
      dir &&
      dir !== b.dir &&
      dir !== OPPOSITE[b.dir]
    ) {
      b.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
      b.speed = C.GLOAMFIN_CORNER_SPEED;
    }
    return dir;
  };
  // Decide the turn before choosing the tick's distance, so a corner costs speed immediately.
  let chosen: Direction | null = null;
  if (atCenter(p)) {
    chosen = choose(p);
    if (chosen === null) return p;
    p.dir = chosen;
  }
  let first = true;
  const moved = move(
    s,
    p,
    p.speed * C.TICK_DT,
    (b) => {
      if (first && chosen) {
        first = false;
        return chosen;
      }
      first = false;
      return choose(b);
    },
    p.state === "den",
  );
  if (
    moved.kind === "gloamfin" &&
    moved.state === "chase" &&
    moved.dir !== previousDir &&
    moved.dir !== OPPOSITE[previousDir]
  )
    moved.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
  if (moved.state === "den" && tile(s, moved.tx, moved.ty) === ".")
    moved.state = "wander";
  return moved;
}
function predators(s: FathomState, cues: CueSink): void {
  s.predators = s.predators.map((original, index) => {
    const p = { ...original };
    p.markLeft = down(p.markLeft);
    p.alertLeft = down(p.alertLeft);
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
    if (p.releaseAt !== null && s.playTime + 1e-9 >= p.releaseAt)
      p.released = true;
    if (!p.mind) return p;
    p.flareFade = down(p.flareFade);
    if (p.state === "den") {
      if (!p.released || !hasDen(s)) return p;
    } else {
      if (p.kind === "gloamfin") soundMind(s, p, index, cues);
      else lightMind(s, p, cues);
    }
    p.speed =
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
    return travelPredator(s, p);
  });
}
function advancePulses(s: FathomState): void {
  const active: Pulse[] = [];
  for (const old of s.pulses) {
    const p = { ...old, front: old.front + C.SONAR_WAVE_SPEED * C.TICK_DT };
    const map = distances(s, { tx: p.ox, ty: p.oy });
    const reached = (tx: number, ty: number) => {
      const d = map[ty * C.GRID_COLS + tx] ?? -1;
      return (
        d >= 0 &&
        d <= p.range &&
        d <= p.front + 1e-9 &&
        (d > old.front + 1e-9 || (old.front === 0 && d === 0))
      );
    };
    if (p.source === "forager") {
      for (let ty = 0; ty < C.GRID_ROWS; ty++)
        for (let tx = 0; tx < C.GRID_COLS; tx++) {
          if (!reached(tx, ty)) continue;
          s.tileMarks[ty * C.GRID_COLS + tx] = C.SONAR_MARK_TIME;
          for (const dir of DIRECTIONS) {
            const n = neighbor(s, tx, ty, dir);
            if (
              tile(s, n.tx, n.ty) === "#" &&
              n.tx >= 0 &&
              n.tx < C.GRID_COLS &&
              n.ty >= 0 &&
              n.ty < C.GRID_ROWS
            )
              s.tileMarks[n.ty * C.GRID_COLS + n.tx] = C.SONAR_MARK_TIME;
          }
        }
      for (const hunter of s.predators) {
        if (!isLoose(s, hunter) || !reached(hunter.tx, hunter.ty)) continue;
        if (hunter.kind !== "lanternjaw") hunter.markLeft = C.SONAR_MARK_TIME;
        if (hunter.kind === "gloamfin" && hunter.mind)
          acquire(s, hunter, s.forager, true);
      }
    } else if (!p.caught && reached(s.forager.tx, s.forager.ty)) {
      p.caught = true;
      const owner = p.owner === null ? undefined : s.predators[p.owner];
      if (owner?.mind && owner.kind === "gloamfin" && isLoose(s, owner))
        acquire(s, owner, s.forager, true);
    }
    if (p.front <= p.range + 1e-9) active.push(p);
  }
  s.pulses = active;
}
/** Lighting is a pure function of this frame and remembered terrain; it runs no minds. */
export function illuminate(s: FathomState): void {
  const flares = s.predators.filter((p) => p.flaring && isLoose(s, p));
  const inFlare = (b: { x: number; y: number }) =>
    flares.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  s.visibility = s.visibility.map((row, ty) =>
    [...row]
      .map((previous, tx) => {
        const c = center(tx, ty);
        const passive =
          distance(c, s.forager) <= s.visionRadius &&
          lineClear(s, s.forager, c, true);
        return passive || inFlare(c) || s.tileMarks[ty * C.GRID_COLS + tx]! > 0
          ? "l"
          : previous === "u"
            ? "u"
            : "r";
      })
      .join(""),
  );
  const passiveBody = (b: Body) =>
    s.visibility[b.ty]?.[b.tx] === "l" &&
    distance(center(b.tx, b.ty), s.forager) <= s.visionRadius &&
    lineClear(s, s.forager, center(b.tx, b.ty), true);
  s.predators = s.predators.map((p) => ({
    ...p,
    lit:
      isLoose(s, p) &&
      (passiveBody(p) ||
        inFlare(p) ||
        p.alert ||
        (p.kind !== "lanternjaw" && p.markLeft > 0)),
  }));
  s.drifters = s.drifters.map((d) => ({
    ...d,
    lit: passiveBody(d) || inFlare(d),
  }));
}
function contact(s: FathomState, cues: CueSink): FathomState {
  if (!s.predators.some((p) => isLoose(s, p) && sameTile(p, s.forager)))
    return s;
  cues.add(C.CUES.caught);
  return s.lives > 0 ? retry(s) : enter(s, "gameover");
}
function eat(s: FathomState, cues: CueSink): void {
  const f = s.forager;
  if (tile(s, f.tx, f.ty) === "." && s.plankton[f.ty]?.[f.tx] === "*") {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    if (!s.planktonRemaining) {
      s.score += C.SCORE_CLEAR;
      cues.add(C.CUES.descend);
      enter(s, "cleared");
    }
  }
  s.drifters = s.drifters.filter((d) => {
    if (!sameTile(d, f)) return true;
    s.score += C.SCORE_DRIFTER;
    return false;
  });
}
export function tick(s: FathomState, cues: CueSink): FathomState {
  s.simTime += C.TICK_DT;
  s.screenTime += C.TICK_DT;
  if (s.screen === "countdown") {
    if (s.screenTime + 1e-9 >= COUNTDOWN_TIME) {
      enter(s, "playing");
      for (const p of s.predators) if (p.releaseAt === 0) p.released = true;
    }
    return s;
  }
  if (s.screen === "cleared")
    return s.screenTime + 1e-9 >= CLEAR_TIME ? nextDepth(s) : s;
  if (s.screen !== "playing") return s;
  const checked = contact(s, cues);
  if (checked.screen !== "playing") return checked;
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  if (s.sonarQueued && s.sonar.cooldown === 0) {
    s.pulses.push({
      source: "forager",
      tint: "cyan",
      ox: s.forager.tx,
      oy: s.forager.ty,
      front: 0,
      range: s.sonar.range,
      owner: null,
      caught: false,
    });
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
  if (s.inkQueued && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  s.sonarQueued = false;
  s.inkQueued = false;
  const decayTime = Math.max(0, C.TICK_DT - s.brightHold);
  s.brightHold = down(s.brightHold);
  s.brightness *= 0.5 ** (decayTime / C.BRIGHT_HALFLIFE);
  s.tileMarks = s.tileMarks.map((t) => down(t));
  if (s.held.length) {
    const old = s.forager;
    s.forager = move(
      s,
      old,
      C.FORAGER_SPEED * C.TICK_DT,
      (b) => {
        const options = exits(s, b);
        return options.includes(s.desired)
          ? s.desired
          : options.includes(b.dir)
            ? b.dir
            : null;
      },
      false,
      s.desired,
    );
    s.forager.moving = distance(old, s.forager) > 1e-8;
  } else s.forager.moving = false;
  eat(s, cues);
  if (s.screen !== "playing") return reconcileOwned(s);
  predators(s, cues);
  advancePulses(s);
  s.drifters = s.drifters.map((d) =>
    d.mind && d.travel
      ? move(s, d, C.DRIFTER_SPEED * C.TICK_DT, (b) => wander(s, b))
      : d,
  );
  s.drifterIn = down(s.drifterIn);
  if (
    !s.drifterIn &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const g = gate(s);
    if (g) {
      const n = DIRECTIONS.map((d) => neighbor(s, g.tx, g.ty, d)).find(
        (b) => tile(s, b.tx, b.ty) === ".",
      );
      if (n) {
        s.drifters.push(drifter(n.tx, n.ty));
        s.drifterIn = C.DRIFTER_INTERVAL;
      }
    }
  }
  // Fresh casts retain their full lifetime on their event tick.
  s.inkClouds = s.inkClouds
    .map((c) => ({
      ...c,
      remaining:
        cues.has(C.CUES.ink) && c.remaining === C.INK_LIFE
          ? c.remaining
          : down(c.remaining),
    }))
    .filter((c) => c.remaining > 0);
  eat(s, cues);
  s.playTime += C.TICK_DT;
  // A slot reports released at its exact boundary; swimming starts next tick.
  for (const p of s.predators)
    if (p.releaseAt !== null && p.releaseAt <= s.playTime + 1e-9)
      p.released = true;
  return reconcileOwned(contact(s, cues));
}
