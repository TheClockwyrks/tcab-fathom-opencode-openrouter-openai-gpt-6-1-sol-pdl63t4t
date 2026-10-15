/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Engine, EngineEventMap } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { game, BACKGROUND } from "./game";
import type { FathomDebugApi, FathomState, ReadState } from "./game";
import {
  center,
  distances,
  exits,
  layer,
  makeMaze,
  neighbor,
  put,
  tile,
} from "./maze";
import { COUNTDOWN_TIME, CLEAR_TIME } from "./world";

// Real engine, real art, real canvas; only the browser's image decoder and fetch
// are substituted with their Node equivalents. No game system is mocked.
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (path: string) =>
      new Response(await readFile(new URL(`../${path}`, import.meta.url))),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
const engines: Engine<FathomState, FathomDebugApi>[] = [];
afterEach(() => {
  engines.splice(0).forEach((e) => e.destroy());
});
async function harness(step = 1000 / C.TICK_HZ) {
  const events = new EventTarget(),
    canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const e = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game,
    background: BACKGROUND,
    layout: C.LAYOUT,
    clock: new ConstantClock(step),
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  engines.push(e);
  const loaded: string[] = [],
    cues: EngineEventMap["cue:played"][] = [];
  e.events.on("asset:loaded", ({ path }) => loaded.push(path));
  e.events.on("cue:played", (cue) => cues.push(cue));
  await e.initialize();
  function key(code: string, down = true) {
    events.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  }
  async function press(code: string) {
    key(code);
    await e.advance(1);
    key(code, false);
  }
  function pointer(type: string, x: number, y: number, device = "mouse") {
    events.dispatchEvent(
      Object.assign(new Event(`pointer${type}`), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        isPrimary: true,
        pointerType: device,
        button: 0,
        buttons: type === "up" ? 0 : 1,
      }),
    );
  }
  function apply(f: (s: ReadState, d: FathomDebugApi) => FathomState) {
    e.apply((s) => f(s, e.debug));
  }
  function playing(rows?: string[]) {
    apply((s, d) => d.clearPredators(s));
    apply((s, d) => d.clearPlankton(s));
    if (rows) apply((s, d) => d.setMaze(s, rows));
    apply((s, d) => d.setScreen(s, "playing"));
  }
  return {
    e,
    canvas,
    key,
    press,
    pointer,
    apply,
    playing,
    loaded,
    cues,
    snap: () => e.debug.snapshot(e.state),
    seconds: (n: number) => e.advance(Math.round((n * 1000) / step)),
  };
}
function fixture(points: [number, number][]): string[] {
  const rows = layer("#");
  points.forEach(([x, y]) => put(rows, x, y, "."));
  return rows;
}
function corridor(y = 5): string[] {
  return fixture(Array.from({ length: C.GRID_COLS - 2 }, (_, i) => [i + 1, y]));
}

describe("maze contract", () => {
  it("lays out a connected symmetric maze with one-wide corridors, no dead ends, a sealed den and the required proportions", () => {
    const tiles = makeMaze(),
      s = { tiles },
      all: { tx: number; ty: number }[] = [];
    for (let ty = 0; ty < C.GRID_ROWS; ty++)
      for (let tx = 0; tx < C.GRID_COLS; tx++) {
        const t = tile(s, tx, ty),
          mirror = tile(s, C.GRID_COLS - 1 - tx, ty);
        if (!"dg".includes(t) && !"dg".includes(mirror)) expect(t).toBe(mirror);
        if (t === ".") {
          const b = { tx, ty };
          all.push(b);
          expect(exits(s, b).length).toBeGreaterThanOrEqual(2);
          expect(
            [
              tile(s, tx + 1, ty),
              tile(s, tx, ty + 1),
              tile(s, tx + 1, ty + 1),
            ].every((t) => t === "."),
          ).toBe(false);
        }
        if (t === "d") expect(exits(s, { tx, ty }).length).toBe(0);
      }
    const map = distances(s, { tx: 17, ty: 13 });
    expect(all.every((b) => map[b.ty * C.GRID_COLS + b.tx]! >= 0)).toBe(true);
    const density = all.length / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2));
    expect(density).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(density).toBeLessThanOrEqual(C.MAZE_DENSITY_MAX);
    const openness =
      all.reduce((sum, b) => sum + exits(s, b).length, 0) / all.length;
    expect(openness).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(openness).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const seen = new Set<number>(),
      runs: number[] = [];
    for (const b of all) {
      const index = b.ty * C.GRID_COLS + b.tx;
      if (seen.has(index) || exits(s, b).length !== 2) continue;
      const queue = [b];
      seen.add(index);
      for (const p of queue)
        for (const dir of exits(s, p)) {
          const n = neighbor(s, p.tx, p.ty, dir),
            ni = n.ty * C.GRID_COLS + n.tx;
          if (!seen.has(ni) && exits(s, n).length === 2) {
            seen.add(ni);
            queue.push(n);
          }
        }
      runs.push(queue.length);
    }
    const run = runs.reduce((sum, n) => sum + n, 0) / runs.length;
    expect(run).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(run).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(
      tiles.filter((r) => r[0] === "." && r[C.GRID_COLS - 1] === "."),
    ).toHaveLength(1);
    expect(tiles.join("").match(/d/g)).toHaveLength(12);
    expect(tiles.join("").match(/g/g)).toHaveLength(1);
    const denMap = distances(s, { tx: 17, ty: 13 }, true);
    expect(denMap[8 * C.GRID_COLS + 18]).toBeGreaterThan(0);
  });
});
describe("engine integration and value state", () => {
  it("loads all 75 frames and exposes a complete fresh snapshot and current diagnostics", async () => {
    const h = await harness();
    expect(h.loaded).toHaveLength(75);
    const s = h.snap();
    expect(s.screen).toBe("title");
    expect(s.version).toBe(C.FATHOM_DEBUG_VERSION);
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(s.predators.map((p) => p.kind)).toEqual(C.DEN_ORDER);
    expect(s.predators.every((p) => p.state === "den" && !p.released)).toBe(
      true,
    );
    expect(s.planktonRemaining).toBe(s.tiles.join("").split(".").length - 1);
    h.apply((s, d) => d.setScore(s, 123));
    expect(h.e.diagnostics().find((d) => d.name === "score")?.value).toBe(123);
    expect(h.e.diagnostics().every((d) => !d.error)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it("never mutates input state and reconcile is pure, idempotent, and senses nothing", async () => {
    const h = await harness();
    const before = h.snap();
    h.apply((s, d) => d.clearFog(d.setBrightness(s, 0.7)));
    const posed = h.snap();
    const reconciled = h.e.debug.reconcile(h.e.state);
    expect(h.e.debug.snapshot(reconciled)).toEqual(posed);
    expect(h.e.debug.snapshot(h.e.debug.reconcile(reconciled))).toEqual(posed);
    expect(posed.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(before.brightness).toBe(0);
    const old = h.e.state,
      oldSnapshot = h.e.debug.snapshot(old);
    await h.e.advance(1);
    expect(h.e.debug.snapshot(old)).toEqual(oldSnapshot);
  });
  it("reset restores the title and every run field, preserving mute", async () => {
    const h = await harness();
    await h.press("KeyM");
    h.apply((s, d) => d.setDepth(d.setScore(d.setTitleIndex(s, 1), 999), 9));
    h.apply((s, d) => d.reset(s));
    const s = h.snap();
    expect(s).toMatchObject({
      screen: "title",
      menuIndex: 0,
      titleIndex: 0,
      depth: 1,
      score: 0,
      lives: C.START_LIVES,
      simTime: 0,
      muted: true,
    });
    expect(s.predators).toHaveLength(3);
  });
  it("rejects invalid debug arguments loudly and allows unrestricted valid poses", async () => {
    const h = await harness();
    const d = h.e.debug,
      s = h.e.state;
    expect(() => d.setMaze(s, ["bad"])).toThrow();
    expect(() => d.setMaze(s, layer("g"))).toThrow();
    expect(() => d.setForagerTile(s, 0, 0)).toThrow();
    expect(() => d.setPredatorMind(s, 20, false)).toThrow();
    expect(() => d.setBrightness(s, 2)).toThrow();
    expect(() => d.setLives(s, 0.5)).toThrow();
    expect(() => d.setMenuIndex(d.setScreen(s, "howto"), 0)).toThrow();
    h.apply((s, d) => d.setSonarCooldown(s, 800));
    expect(h.snap().sonar.cooldown).toBe(800);
    for (let i = 0; i < 4; i++) h.apply((s, d) => d.spawnDrifter(s, 1, 1));
    expect(h.snap().drifters).toHaveLength(4);
  });
});
describe("screens and input", () => {
  it("remembers the title selection across how-to and supports wrapped menu edges", async () => {
    const h = await harness();
    await h.press("ArrowUp");
    expect(h.snap().menuIndex).toBe(1);
    await h.press("Enter");
    expect(h.snap().screen).toBe("howto");
    await h.press("Escape");
    expect(h.snap()).toMatchObject({
      screen: "title",
      menuIndex: 1,
      titleIndex: 1,
    });
    await h.press("ArrowDown");
    await h.press("Space");
    expect(h.snap().screen).toBe("countdown");
    await h.seconds(COUNTDOWN_TIME);
    expect(h.snap().screen).toBe("playing");
    expect(h.snap().pulses).toHaveLength(0);
  });
  it("Escape opens and closes pause exactly once; everything but simTime freezes", async () => {
    const h = await harness();
    h.playing();
    await h.seconds(0.2);
    await h.press("Escape");
    const before = h.snap();
    expect(before.screen).toBe("paused");
    await h.seconds(1);
    const after = h.snap();
    expect(after.simTime).toBeCloseTo(before.simTime + 1);
    expect({ ...after, simTime: 0 }).toEqual({ ...before, simTime: 0 });
    await h.press("Escape");
    expect(h.snap().screen).toBe("playing");
  });
  it("the paused maze is visually frozen, including every creature's swim cycle", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.key("ArrowRight");
    await h.seconds(0.15);
    await h.press("Escape");
    const before = h.canvas.toBuffer("image/png");
    await h.seconds(0.3);
    expect(h.canvas.toBuffer("image/png")).toEqual(before);
  });
  it("pointer and touch confirmations require both edges in the same item", async () => {
    const h = await harness();
    const d = h.e.debug;
    const a = d.menuItemRect(h.e.state, 0)!,
      b = d.menuItemRect(h.e.state, 1)!;
    h.pointer("move", b.x + 20, b.y + 20);
    await h.e.advance(1);
    expect(h.snap().menuIndex).toBe(1);
    h.pointer("down", a.x + 20, a.y + 20);
    h.pointer("up", b.x + 20, b.y + 20);
    await h.e.advance(1);
    expect(h.snap().screen).toBe("title");
    h.pointer("down", b.x + 20, b.y + 20, "touch");
    h.pointer("up", b.x + 20, b.y + 20, "touch");
    await h.e.advance(1);
    expect(h.snap().screen).toBe("howto");
    h.pointer("down", 10, 10);
    await h.e.advance(1);
    h.pointer("up", 10, 10);
    await h.e.advance(1);
    expect(h.snap()).toMatchObject({
      screen: "title",
      menuIndex: 1,
      titleIndex: 1,
    });
  });
  it("restart, quit and game-over menu begin fresh runs and remember titleIndex", async () => {
    const h = await harness();
    h.playing();
    h.apply((s, d) => d.setScore(s, 900));
    await h.press("KeyP");
    await h.press("ArrowDown");
    await h.press("Enter");
    expect(h.snap()).toMatchObject({
      screen: "countdown",
      score: 0,
      depth: 1,
      lives: C.START_LIVES,
    });
    h.apply((s, d) => d.setScreen(s, "paused"));
    h.apply((s, d) => d.setMenuIndex(s, 2));
    await h.press("Enter");
    expect(h.snap().screen).toBe("title");
    h.apply((s, d) => d.setScreen(s, "gameover"));
    await h.press("Enter");
    expect(h.snap().screen).toBe("countdown");
    h.apply((s, d) => d.setScreen(s, "gameover"));
    await h.press("Escape");
    expect(h.snap().screen).toBe("title");
  });
});
describe("fixed-step travel and grazing", () => {
  it("moves at 128 units/s, stops on release, buffers a corner and reverses immediately", async () => {
    const h = await harness();
    const rows = corridor();
    for (let y = 6; y < 10; y++) put(rows, 6, y, ".");
    h.playing(rows);
    h.apply((s, d) => d.setForagerTile(s, 4, 5));
    h.key("ArrowRight");
    await h.seconds(0.25);
    expect(h.snap().forager.x).toBeCloseTo(center(5, 5).x);
    await h.seconds(0.125);
    h.key("ArrowDown");
    await h.seconds(0.125);
    expect(h.snap().forager).toMatchObject({ tx: 6, ty: 5 });
    await h.seconds(0.125);
    expect(h.snap().forager.y).toBeCloseTo(center(6, 5).y + 16);
    h.key("ArrowRight", false);
    h.key("ArrowDown", false);
    const y = h.snap().forager.y;
    await h.seconds(0.1);
    expect(h.snap().forager).toMatchObject({ moving: false, y });
    h.key("ArrowUp");
    await h.e.advance(1);
    expect(h.snap().forager.y).toBeLessThan(y);
  });
  it("stays on an isolated tile and handles a wrap as one continuous 32-unit step", async () => {
    const h = await harness();
    h.playing(fixture([[4, 5]]));
    h.apply((s, d) => d.setForagerTile(s, 4, 5));
    h.key("ArrowRight");
    await h.seconds(1);
    expect(h.snap().forager.x).toBe(center(4, 5).x);
    const rows = layer("#");
    rows[5] = ".".repeat(C.GRID_COLS);
    h.apply((s, d) => d.setMaze(s, rows));
    h.apply((s, d) => d.setForagerTile(s, C.GRID_COLS - 1, 5));
    await h.seconds(0.25);
    expect(h.snap().forager.x).toBeCloseTo(center(0, 5).x);
    expect(h.snap().forager.tx).toBe(0);
  });
  it("has identical simulation outcomes for uneven frame partitions, including fog memory", async () => {
    const a = await harness(1000 / 60),
      b = await harness(1000 / 60);
    for (const h of [a, b]) {
      h.playing(corridor());
      h.apply((s, d) => d.setForagerTile(s, 5, 5));
      h.key("ArrowRight");
    }
    b.e.setClock(new SequenceClock([5, 20, 25]));
    await a.e.advance(60);
    await b.e.advance(60);
    expect(a.snap()).toEqual(b.snap());
  });
  it("eats on tile entry, raises brightness and holds it before the exact half-life decay", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.setPlankton(d.setPlankton(s, 5, 5, true), 30, 5, true));
    await h.e.advance(1);
    expect(h.snap()).toMatchObject({
      score: C.SCORE_PLANKTON,
      brightness: C.BRIGHT_PER_EAT,
      brightHold: C.BRIGHT_HOLD,
      planktonRemaining: 1,
    });
    await h.seconds(C.BRIGHT_HOLD);
    expect(h.snap().brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    await h.seconds(C.BRIGHT_HALFLIFE);
    expect(h.snap().brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2);
    expect(h.cues.filter((c) => c.cue === C.CUES.eat)).toHaveLength(1);
  });
  it("clears only by eating the last mote, then descends with score and reserves intact", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    await h.seconds(0.2);
    expect(h.snap().screen).toBe("playing");
    h.apply((s, d) => d.setPlankton(s, 5, 5, true));
    await h.e.advance(1);
    expect(h.snap()).toMatchObject({
      screen: "cleared",
      score: C.SCORE_PLANKTON + C.SCORE_CLEAR,
    });
    await h.seconds(CLEAR_TIME);
    expect(h.snap()).toMatchObject({
      screen: "countdown",
      depth: 2,
      lives: C.START_LIVES,
      score: C.SCORE_PLANKTON + C.SCORE_CLEAR,
    });
    expect(h.snap().predators.map((p) => p.kind)).toEqual([
      ...C.DEN_ORDER,
      C.ROSTER_ADD_ORDER[0],
    ]);
    expect(h.snap().sonar.range).toBe(C.SONAR_RANGE_BASE - 1);
  });
});
describe("senses, sonar and ink", () => {
  it("paints remembered terrain beyond the outer circle to flat fog, then shows it again on return", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    await h.e.advance(1);
    h.apply((s, d) => d.setForagerTile(s, 22, 5));
    await h.e.advance(1);
    const pixel = (tx: number, ty: number) => {
      const c = center(tx, ty);
      return [...h.canvas.getContext("2d").getImageData(c.x, c.y, 1, 1).data];
    };
    expect(h.snap().visibility[5]![5]).toBe("r");
    const fog = pixel(0, 0);
    expect(pixel(5, 5)).toEqual(fog);
    h.apply((s, d) => d.setForagerTile(s, 10, 5));
    await h.e.advance(1);
    expect(h.snap().visibility[5]![5]).toBe("r");
    expect(pixel(5, 5)).not.toEqual(fog);
  });
  it("light stops at rock, remembered ground survives outside the true vision window", async () => {
    const h = await harness();
    const rows = corridor();
    put(rows, 7, 5, "#");
    h.playing(rows);
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    await h.e.advance(1);
    expect(h.snap().visibility[5]![7]).toBe("l");
    expect(h.snap().visibility[5]![8]).toBe("u");
    h.apply((s, d) => d.setForagerTile(s, 22, 5));
    await h.e.advance(1);
    expect(h.snap().visibility[5]![5]).toBe("r");
    expect(h.snap().windowRadius).toBe(C.KINDLE_VISION_MIN);
    h.apply((s, d) => d.setBrightness(s, 1));
    expect(h.snap().windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN,
    );
  });
  it("sonar travels around bends, lights bounding rock, marks hunters on arrival and never resolves amber entities", async () => {
    const h = await harness();
    const rows = fixture([
      [5, 5],
      [6, 5],
      [7, 5],
      [7, 6],
      [7, 7],
      [7, 8],
      [7, 9],
      [8, 9],
      [9, 9],
    ]);
    h.playing(rows);
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    for (const kind of C.DEN_ORDER) {
      h.apply((s, d) => d.addPredator(s, kind, 7, 8));
      h.apply((s, d) => d.setPredatorMind(s, s.predators.length - 1, false));
    }
    h.apply((s, d) => d.spawnDrifter(s, 7, 8));
    h.apply((s, d) => d.setDrifterMind(s, 0, false));
    await h.press("Space");
    expect(h.snap().predators.every((p) => !p.lit)).toBe(true);
    await h.seconds(0.4);
    expect(h.snap().predators.map((p) => p.lit)).toEqual([false, true, true]);
    expect(h.snap().drifters[0]!.lit).toBe(false);
    expect(h.snap().visibility[8]![7]).toBe("l");
    expect(h.snap().visibility[8]![6]).toBe("l");
    expect(h.snap().visibility[9]![9]).toBe("u");
    expect(h.snap().sonar.cooldown).toBeGreaterThan(0);
    await h.seconds(2);
    expect(h.snap().predators.every((p) => !p.lit)).toBe(true);
    expect(h.snap().visibility[8]![7]).toBe("r");
  });
  it("ink is fixed, expires after three seconds and instantly breaks a light-hunter fix", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.addPredator(s, "lanternjaw", 8, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.e.advance(1);
    expect(h.snap().predators[0]!.state).toBe("chase");
    await h.press("ShiftLeft");
    expect(h.snap().predators[0]!.state).toBe("wander");
    const cloud = h.snap().inkClouds[0]!;
    h.key("ArrowLeft");
    await h.seconds(0.2);
    expect(h.snap().inkClouds[0]!.x).toBe(cloud.x);
    expect(h.snap().ink.cooldown).toBeGreaterThan(0);
    await h.seconds(C.INK_LIFE);
    expect(h.snap().inkClouds).toHaveLength(0);
  });
});
describe("the three hunters", () => {
  it("Lanternjaw senses light, lingers for two seconds and has no acquisition alert", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 8, 5));
    h.apply((s, d) => d.addPredator(s, "lanternjaw", 5, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.e.advance(1);
    expect(h.snap().predators[0]).toMatchObject({
      state: "chase",
      speed: C.PREDATOR_SPEED,
      alert: false,
    });
    h.apply((s, d) => d.setForagerTile(s, 30, 5));
    await h.seconds(1.9);
    expect(h.snap().predators[0]!.state).toBe("chase");
    await h.seconds(0.1);
    expect(h.snap().predators[0]).toMatchObject({
      state: "wander",
      speed: C.DRIFTER_SPEED,
    });
  });
  it("Gloamfin hears through rock and ink while holding still with travel disabled", async () => {
    const h = await harness();
    h.playing(
      fixture([
        [5, 5],
        [7, 5],
      ]),
    );
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.addPredator(s, "gloamfin", 7, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.press("ShiftLeft");
    expect(h.snap().predators[0]).toMatchObject({
      state: "chase",
      hearingLock: true,
      alert: true,
      speed: C.GLOAMFIN_CHASE_SPEED,
    });
    await h.seconds(0.6);
    expect(h.snap().predators[0]).toMatchObject({ alert: false, tx: 7, ty: 5 });
    expect(h.snap().pulses).toHaveLength(0);
  });
  it("a forager pulse alerts Gloamfin only when its front arrives; its fixed target does not follow", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.addPredator(s, "gloamfin", 10, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.press("Space");
    expect(h.snap().predators[0]!.state).toBe("wander");
    await h.seconds(0.36);
    expect(h.snap().predators[0]).toMatchObject({
      state: "chase",
      alert: true,
    });
    h.apply((s, d) => d.setForagerTile(s, 25, 5));
    await h.e.advance(1);
    expect(h.e.state.predators[0]!.fix).toEqual({ tx: 5, ty: 5 });
  });
  it("Gloamfin paths around rock, loses speed on a corner, then searches and casts its orange ping", async () => {
    const h = await harness();
    const rows = fixture([
      [3, 5],
      [4, 5],
      [5, 5],
      [5, 6],
      [5, 7],
      [6, 7],
      [7, 7],
      [8, 7],
      [9, 7],
      [10, 7],
      [11, 7],
      [12, 7],
      [13, 7],
      [14, 7],
      [15, 7],
      [30, 5],
    ]);
    h.playing(rows);
    h.apply((s, d) => d.setForagerTile(s, 8, 7));
    h.apply((s, d) => d.addPredator(s, "gloamfin", 3, 5));
    h.apply((s, d) => d.setPredatorState(s, 0, "chase"));
    h.apply((s, d) => d.setForagerTile(s, 30, 5));
    await h.seconds(0.6);
    expect(h.snap().predators[0]!.speed).toBeLessThan(C.GLOAMFIN_CHASE_SPEED);
    expect(h.snap().predators[0]!.ty).toBeGreaterThanOrEqual(5);
    await h.seconds(1.6);
    expect(h.snap().predators[0]!.state).toBe("search");
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.seconds(C.GLOAMFIN_SEARCH_DELAY + 0.1);
    expect(h.cues.some((c) => c.cue === C.CUES.predatorPing)).toBe(true);
    expect(h.snap().pulses.some((p) => p.tint === "orange")).toBe(true);
    await h.seconds(C.GLOAMFIN_GIVEUP);
    expect(h.snap().predators[0]!.state).toBe("wander");
  });
  it("Gloamfin's own ping catches on arrival and reveals no terrain", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.addPredator(s, "gloamfin", 12, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.seconds(C.GLOAMFIN_PING_INTERVAL);
    expect(h.snap().pulses[0]?.tint).toBe("violet");
    expect(h.snap().predators[0]!.state).toBe("wander");
    await h.seconds(0.51);
    expect(h.snap().predators[0]).toMatchObject({
      state: "chase",
      alert: true,
    });
    expect(h.snap().visibility[5]![12]).toBe("u");
  });
  it("a broken hearing lock queues a ping at the minimum gap, even before the ordinary timer expires", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.addPredator(s, "gloamfin", 12, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.seconds(C.GLOAMFIN_PING_INTERVAL);
    await h.e.advance(24);
    h.apply((s, d) => d.setForagerTile(s, 10, 5));
    await h.e.advance(25);
    expect(h.snap().predators[0]!.hearingLock).toBe(true);
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    await h.e.advance(310);
    expect(h.cues.filter((c) => c.cue === C.CUES.predatorPing)).toHaveLength(1);
    await h.e.advance(1);
    expect(h.cues.filter((c) => c.cue === C.CUES.predatorPing)).toHaveLength(2);
  });
  it("returning Flarefish to wander re-arms the entire seven-second interval", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 2, 5));
    h.apply((s, d) => d.addPredator(s, "flarefish", 5, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.e.advance(1);
    expect(h.snap().predators[0]!.state).toBe("chase");
    await h.press("ShiftLeft");
    expect(h.snap().predators[0]!.state).toBe("wander");
    h.apply((s, d) => d.setForagerTile(s, 30, 5));
    await h.seconds(C.FLARE_INTERVAL - C.TICK_DT);
    expect(h.snap().predators[0]!.flareCharging).toBe(false);
    await h.e.advance(1);
    expect(h.snap().predators[0]!.flareCharging).toBe(true);
  });
  it("Flarefish charges, blooms through rock and returns to full darkness after the bloom", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 2, 5));
    h.apply((s, d) => d.addPredator(s, "flarefish", 25, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.seconds(C.FLARE_INTERVAL);
    expect(h.snap().predators[0]!.flareCharging).toBe(true);
    await h.seconds(C.FLARE_CHARGE);
    expect(h.snap().predators[0]).toMatchObject({
      flaring: true,
      flareRadius: C.FLARE_RADIUS,
    });
    expect(h.snap().visibility[5]![25]).toBe("l");
    expect(h.snap().visibility[3]![25]).toBe("l");
    await h.seconds(C.FLARE_BLOOM);
    expect(h.snap().predators[0]).toMatchObject({
      flaring: false,
      flareRadius: 0,
      lit: false,
    });
    expect(h.snap().visibility[5]![25]).toBe("r");
    expect(h.cues.filter((c) => c.cue === C.CUES.flare)).toHaveLength(1);
  });
  it("a Flarefish bloom acquires through rock and stops blooming at the lock", async () => {
    const h = await harness();
    const rows = fixture([
      [5, 5],
      [10, 5],
    ]);
    h.playing(rows);
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.addPredator(s, "flarefish", 10, 5));
    h.apply((s, d) => d.setPredatorTravel(s, 0, false));
    await h.seconds(C.FLARE_INTERVAL + C.FLARE_CHARGE);
    expect(h.snap().predators[0]).toMatchObject({
      state: "chase",
      alert: true,
      flaring: false,
    });
  });
  it("mind-off bodies hold still and do not sense, but still make contact", async () => {
    const h = await harness();
    h.playing(corridor());
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.addPredator(s, "flarefish", 8, 5));
    h.apply((s, d) => d.setPredatorMind(s, 0, false));
    await h.seconds(1);
    expect(h.snap().predators[0]).toMatchObject({
      tx: 8,
      state: "wander",
      alert: false,
    });
    h.apply((s, d) => d.setForagerTile(s, 8, 5));
    await h.e.advance(1);
    expect(h.snap()).toMatchObject({
      lives: C.START_LIVES - 1,
      screen: "countdown",
    });
  });
  it("the den releases on live-time slots; countdown and pause do not spend the schedule", async () => {
    const h = await harness(1000 / 30);
    h.apply((s, d) => d.setScreen(s, "countdown"));
    await h.seconds(COUNTDOWN_TIME - 0.1);
    expect(h.snap().predators.every((p) => !p.released)).toBe(true);
    await h.seconds(0.1);
    expect(h.snap().predators.map((p) => p.released)).toEqual([
      true,
      false,
      false,
    ]);
    await h.press("KeyP");
    await h.seconds(6);
    expect(h.snap().predators[1]!.released).toBe(false);
    await h.press("KeyP");
    await h.seconds(C.DEN_RELEASE_GAP);
    expect(h.snap().predators[1]!.released).toBe(true);
  });
});
describe("drifters, lives, and audio", () => {
  it("admits a drifter on cadence only with plankton and a gate, then scores its tile contact", async () => {
    const h = await harness();
    h.playing();
    h.apply((s, d) => d.setPlankton(s, 1, 1, true));
    h.apply((s, d) => d.setDrifterIn(s, 0));
    await h.e.advance(1);
    expect(h.snap().drifters).toHaveLength(1);
    expect(h.snap().drifterIn).toBe(C.DRIFTER_INTERVAL);
    h.apply((s, d) => d.setDrifterTravel(s, 0, false));
    const d = h.snap().drifters[0]!;
    h.apply((s, api) => api.setForagerTile(s, d.tx, d.ty));
    await h.e.advance(1);
    expect(h.snap().drifters).toHaveLength(0);
    expect(h.snap().score).toBe(C.SCORE_DRIFTER);
    h.apply((s, d) => d.clearPlankton(s));
    h.apply((s, d) => d.setDrifterIn(s, 0));
    await h.e.advance(1);
    expect(h.snap().drifters).toHaveLength(0);
  });
  it("life loss preserves score, eaten plankton and fog, while zero reserves ends the run", async () => {
    const h = await harness();
    h.playing();
    h.apply((s, d) => d.setScore(s, 123));
    await h.e.advance(1);
    const fog = h.snap().visibility.join("");
    expect(fog).toContain("l");
    const f = h.snap().forager;
    h.apply((s, d) => d.addPredator(s, "lanternjaw", f.tx, f.ty));
    await h.e.advance(1);
    expect(h.snap()).toMatchObject({
      screen: "countdown",
      score: 123,
      lives: 2,
      planktonRemaining: 0,
    });
    expect(
      h.snap().predators.every((p) => p.state === "den" && !p.released),
    ).toBe(true);
    expect(h.snap().visibility.join("")).not.toMatch(/^u+$/);
    h.apply((s, d) =>
      d.setLives(d.clearPredators(d.setScreen(s, "playing")), 0),
    );
    h.apply((s, d) => d.addPredator(s, "gloamfin", s.forager.tx, s.forager.ty));
    await h.e.advance(1);
    expect(h.snap()).toMatchObject({
      screen: "gameover",
      lives: 0,
      score: 123,
    });
  });
  it("mute silences the cue bus without suppressing events or simulation", async () => {
    const h = await harness();
    await h.press("KeyM");
    h.playing();
    await h.press("Space");
    expect(h.cues.find((c) => c.cue === C.CUES.sonar)?.gain).toBe(0);
    expect(h.snap().pulses).toHaveLength(1);
    expect(h.snap().muted).toBe(true);
    await h.press("KeyM");
    expect(h.snap().muted).toBe(false);
  });
  it("a denless fixture holds den predators out of play and a gateless cadence admits nothing", async () => {
    const h = await harness();
    h.apply((s, d) => d.setMaze(s, corridor()));
    h.apply((s, d) => d.setForagerTile(s, 5, 5));
    h.apply((s, d) => d.setScreen(s, "playing"));
    h.apply((s, d) => d.setDrifterIn(s, 0));
    await h.seconds(6);
    expect(h.snap().predators.every((p) => p.state === "den" && !p.lit)).toBe(
      true,
    );
    expect(h.snap().drifters).toHaveLength(0);
  });
});
