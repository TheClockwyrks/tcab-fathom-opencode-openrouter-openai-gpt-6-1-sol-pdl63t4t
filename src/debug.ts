import * as C from "./constants";
import { center, DIRECTIONS, layer, put, tile } from "./maze";
import { menuItemRect, menuItems } from "./menus";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  Predator,
  ReadState,
} from "./types";
import {
  copy,
  drifter,
  enter,
  fresh,
  predator,
  reconcileOwned,
  roster,
  snapshot,
} from "./world";

function assert(valid: boolean, message: string): asserts valid {
  if (!valid) throw new RangeError(`Fathom: ${message}`);
}
function number(n: number, min = 0, max = Infinity, integer = false): void {
  assert(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
    `invalid number ${n}`,
  );
}
function bool(value: boolean): void {
  assert(typeof value === "boolean", "expected a boolean");
}
function direction(dir: Direction): void {
  assert(DIRECTIONS.includes(dir), `invalid direction ${dir}`);
}
function position(s: ReadState, tx: number, ty: number, den = false): void {
  number(tx, 0, C.GRID_COLS - 1, true);
  number(ty, 0, C.GRID_ROWS - 1, true);
  assert(
    (den ? ".dg" : ".").includes(tile(s, tx, ty)),
    "tile is closed to this body",
  );
}
function pose(s: ReadState, effect: (s: FathomState) => void): FathomState {
  const next = copy(s);
  effect(next);
  return reconcileOwned(next);
}
function hunter(
  s: ReadState,
  index: number,
  effect: (p: Predator, s: FathomState) => void,
): FathomState {
  number(index, 0, s.predators.length - 1, true);
  return pose(s, (next) => effect(next.predators[index]!, next));
}
function driftFlag(
  s: ReadState,
  index: number,
  enabled: boolean,
  field: "mind" | "travel",
): FathomState {
  number(index, 0, s.drifters.length - 1, true);
  bool(enabled);
  return pose(s, (next) => {
    next.drifters[index]![field] = enabled;
  });
}
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) => fresh(copy(s).art, s.muted),
  snapshot,
  reconcile: (s) => reconcileOwned(copy(s)),
  setScreen(s, screen) {
    assert(
      [
        "title",
        "howto",
        "countdown",
        "playing",
        "paused",
        "cleared",
        "gameover",
      ].includes(screen),
      "invalid screen",
    );
    return enter(copy(s), screen);
  },
  setMenuIndex(s, index) {
    number(index, 0, menuItems(s).length - 1, true);
    return pose(s, (n) => {
      n.menuIndex = index;
    });
  },
  setTitleIndex(s, index) {
    number(index, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => {
      n.titleIndex = index;
    });
  },
  menuItemRect,
  setScore(s, points) {
    number(points, 0, Infinity, true);
    return pose(s, (n) => {
      n.score = points;
    });
  },
  setLives(s, lives) {
    number(lives, 0, Infinity, true);
    return pose(s, (n) => {
      n.lives = lives;
    });
  },
  setDepth(s, depth) {
    number(depth, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = depth;
      n.predators = roster(depth, n.tiles);
    });
  },
  setMaze(s, rows) {
    assert(
      Array.isArray(rows) &&
        rows.length === C.GRID_ROWS &&
        rows.every(
          (r) =>
            typeof r === "string" &&
            r.length === C.GRID_COLS &&
            /^[#.dg]+$/.test(r),
        ),
      "invalid maze dimensions or alphabet",
    );
    const gates = rows.join("").split("g").length - 1;
    assert(
      !rows.some((r) => /[dg]/.test(r)) || gates === 1,
      "a den requires exactly one gate",
    );
    return pose(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton(s, tx, ty, present) {
    position(s, tx, ty);
    bool(present);
    return pose(s, (n) => put(n.plankton, tx, ty, present ? "*" : "-"));
  },
  clearPlankton: (s) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = layer("u");
      n.tileMarks.fill(0);
    }),
  setForagerTile(s, tx, ty) {
    position(s, tx, ty);
    return pose(s, (n) => {
      n.forager = { ...n.forager, ...center(tx, ty), moving: false };
      n.held = [];
    });
  },
  setForagerDir(s, dir) {
    direction(dir);
    return pose(s, (n) => {
      n.forager.dir = dir;
      n.desired = dir;
      n.forager.moving = false;
      n.held = [];
    });
  },
  setBrightness(s, g) {
    number(g, 0, 1);
    return pose(s, (n) => {
      n.brightness = g;
    });
  },
  setBrightHold(s, seconds) {
    number(seconds, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = seconds;
    });
  },
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator(s, kind, tx, ty) {
    assert(C.DEN_ORDER.includes(kind), "invalid predator kind");
    position(s, tx, ty);
    return pose(s, (n) => {
      n.predators.push(predator(kind, tx, ty));
    });
  },
  setPredatorTile(s, index, tx, ty) {
    position(s, tx, ty, true);
    return hunter(s, index, (p) => Object.assign(p, center(tx, ty)));
  },
  setPredatorDir(s, index, dir) {
    direction(dir);
    return hunter(s, index, (p) => {
      p.dir = dir;
    });
  },
  setPredatorState(s, index, state) {
    assert(
      ["den", "wander", "chase"].includes(state),
      "invalid predator state",
    );
    return hunter(s, index, (p, n) => {
      assert(
        (state === "den" ? "dg" : ".").includes(tile(n, p.tx, p.ty)),
        "predator state is invalid on this tile",
      );
      p.state = state;
      p.fix = state === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = state === "chase" ? C.LINGER_TIME : 0;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      p.alert = false;
      p.alertLeft = 0;
      if (p.kind === "flarefish") {
        p.flaring = false;
        p.flareCharging = false;
        p.flareRadius = 0;
        p.flareIn = C.FLARE_INTERVAL;
        p.flareTime = 0;
      }
    });
  },
  setPredatorReleased(s, index, released) {
    bool(released);
    return hunter(s, index, (p) => {
      p.released = released;
    });
  },
  setPredatorMind(s, index, enabled) {
    bool(enabled);
    return hunter(s, index, (p) => {
      p.mind = enabled;
    });
  },
  setPredatorTravel(s, index, enabled) {
    bool(enabled);
    return hunter(s, index, (p) => {
      p.travel = enabled;
    });
  },
  spawnDrifter(s, tx, ty) {
    position(s, tx, ty);
    return pose(s, (n) => {
      n.drifters.push(drifter(tx, ty));
    });
  },
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, index, enabled) => driftFlag(s, index, enabled, "mind"),
  setDrifterTravel: (s, index, enabled) =>
    driftFlag(s, index, enabled, "travel"),
  setDrifterIn(s, seconds) {
    number(seconds, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = seconds;
    });
  },
  setSonarCooldown(s, seconds) {
    number(seconds);
    return pose(s, (n) => {
      n.sonar.cooldown = seconds;
    });
  },
  setInkCooldown(s, seconds) {
    number(seconds);
    return pose(s, (n) => {
      n.ink.cooldown = seconds;
    });
  },
};
