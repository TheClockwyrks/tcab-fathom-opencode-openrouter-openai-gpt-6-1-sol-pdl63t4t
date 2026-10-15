import type { CueSpec, Game } from "@clockwyrks/simple-2d";
import "./stage.css";
import * as C from "./constants";
import { debug } from "./debug";
import { controls } from "./menus";
import { BACKGROUND, render } from "./presentation";
import { illuminate, tick } from "./simulation";
import type { Art, FathomDebugApi, FathomState } from "./types";
import { copy, fresh, reconcileOwned } from "./world";

export { BACKGROUND };
export type { PredatorKind } from "./constants";
export type * from "./types";

const SHEETS: Readonly<Record<string, number>> = {
  glimmerfin: 8,
  lanternjaw: 16,
  gloamfin: 8,
  flarefish: 8,
  drifter: 8,
  "flare-bloom": 8,
  "trench-walls": 19,
};
const SOUNDS: Record<C.CueName, CueSpec> = {
  [C.CUES.eat]: {
    wave: "sine",
    freq: 780,
    freqTo: 1200,
    gain: 0.07,
    durationMs: 65,
  },
  [C.CUES.sonar]: {
    wave: "sine",
    freq: 1040,
    freqTo: 210,
    gain: 0.17,
    durationMs: 400,
  },
  [C.CUES.ink]: {
    wave: "triangle",
    freq: 180,
    freqTo: 42,
    gain: 0.18,
    durationMs: 350,
  },
  [C.CUES.predatorPing]: {
    wave: "sine",
    freq: 340,
    freqTo: 680,
    gain: 0.13,
    durationMs: 260,
  },
  [C.CUES.flare]: {
    wave: "sawtooth",
    freq: 95,
    freqTo: 540,
    gain: 0.08,
    durationMs: 420,
  },
  [C.CUES.caught]: {
    wave: "square",
    freq: 230,
    freqTo: 38,
    gain: 0.12,
    durationMs: 500,
  },
  [C.CUES.descend]: {
    wave: "triangle",
    freq: 390,
    freqTo: 1250,
    gain: 0.17,
    durationMs: 700,
  },
};
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTIONS)
      api.input.register(name, { keys: [...C.BINDINGS[name]] });
    for (const cue of Object.values(C.CUES)) api.audio.define(cue, SOUNDS[cue]);
    for (const name of [
      "screen",
      "depth",
      "score",
      "lives",
      "planktonRemaining",
      "brightness",
      "visionRadius",
      "windowRadius",
    ] as const)
      api.diagnostics.register(name, (s) => s[name]);
    api.diagnostics.register("sonar cooldown", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink cooldown", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    // All roster entries, including fixture-added hunters, fit on one short line each.
    for (let i = 0; i < C.DEN_ORDER.length * C.ROSTER_CAP; i++)
      api.diagnostics.register(`predator ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "none";
      });
    api.diagnostics.register(
      "extra predators",
      (s) =>
        s.predators
          .slice(C.DEN_ORDER.length * C.ROSTER_CAP)
          .map(
            (p) => `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed} ${p.alert}`,
          )
          .join("; ") || "none",
    );
    const art: Art = Object.fromEntries(
      await Promise.all(
        Object.entries(SHEETS).map(async ([name, count]) => [
          name,
          await Promise.all(
            Array.from({ length: count }, (_, frame) =>
              api.assets.loadImage(`${name}/${frame}.png`),
            ),
          ),
        ]),
      ),
    );
    return [fresh(art), debug];
  },
  update(state, api, dt) {
    let s = controls(copy(state), api);
    s.accumulator += dt;
    const ticks = Math.floor((s.accumulator + 1e-10) / C.TICK_DT);
    s.accumulator = Math.max(0, s.accumulator - ticks * C.TICK_DT);
    if (s.screen === "playing" || s.screen === "countdown")
      illuminate(reconcileOwned(s));
    for (let i = 0; i < ticks; i++) {
      const cues = new Set<C.CueName>();
      s = tick(s, cues);
      if (s.screen === "playing" || s.screen === "countdown")
        illuminate(reconcileOwned(s));
      for (const cue of cues) api.audio.play(cue);
    }
    reconcileOwned(s);
    if (s.screen === "playing" || s.screen === "countdown") illuminate(s);
    s.muted = api.audio.muted();
    return s;
  },
  render,
};
