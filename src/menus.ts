import type { UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { FathomState, ReadState, Rect } from "./types";
import { enter, newRun } from "./world";

export function menuItems(s: Pick<ReadState, "screen">): readonly string[] {
  return s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(s: ReadState, index: number): Rect | null {
  if (!Number.isInteger(index) || index < 0 || index >= menuItems(s).length)
    return null;
  return s.screen === "title"
    ? { x: 110, y: 442 + index * 66, w: 350, h: 54 }
    : { x: 455, y: 365 + index * 64, w: 370, h: 52 };
}
function hit(s: ReadState, x: number, y: number): number {
  return menuItems(s).findIndex((_, i) => {
    const r = menuItemRect(s, i)!;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  });
}
function confirm(s: FathomState): FathomState {
  const item = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = item!;
    return item === 0 ? newRun(s, "countdown") : enter(s, "howto");
  }
  if (s.screen === "paused")
    return item === 0
      ? enter(s, "playing")
      : newRun(s, item === 1 ? "countdown" : "title");
  if (s.screen === "gameover")
    return newRun(s, item === 0 ? "countdown" : "title");
  return s;
}
/** Edges are consumed once per engine frame; a transition cannot reuse a key. */
export function controls(s: FathomState, api: UpdateApi): FathomState {
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  if (s.screen === "playing") {
    if (api.input.pressed("pause")) return enter(s, "paused");
    const held = (["up", "down", "left", "right"] as const).filter(
      (d) => api.input.value(d) > 0,
    );
    const fresh = held.filter((d) => !s.held.includes(d));
    if (fresh.length) s.desired = fresh[fresh.length - 1]!;
    else if (held.length && !held.includes(s.desired))
      s.desired = held[held.length - 1]!;
    s.held = held;
    s.sonarQueued ||= api.input.pressed("a");
    s.inkQueued ||= api.input.pressed("b");
    return s;
  }
  if (s.screen === "paused") {
    const pause = api.input.pressed("pause"),
      back = api.input.pressed("back");
    if (pause || back) return enter(s, "playing");
  }
  if (s.screen === "howto") {
    if (api.input.pressed("confirm") || api.input.pressed("back"))
      return newRun(s, "title");
    for (const sample of api.input.pointerSamples()) {
      if (!sample.primary) continue;
      if (sample.type === "down")
        s.pointerPress = { id: sample.id, item: -1, screen: "howto" };
      if (
        sample.type === "up" &&
        s.pointerPress?.id === sample.id &&
        s.pointerPress.screen === "howto"
      )
        return newRun(s, "title");
    }
    return s;
  }
  const items = menuItems(s);
  if (!items.length) return s;
  if (api.input.pressed("back") && s.screen === "gameover")
    return newRun(s, "title");
  if (api.input.pressed("up"))
    s.menuIndex = (s.menuIndex! + items.length - 1) % items.length;
  if (api.input.pressed("down"))
    s.menuIndex = (s.menuIndex! + 1) % items.length;
  let clicked = false;
  for (const sample of api.input.pointerSamples()) {
    if (
      !sample.primary ||
      (sample.button !== null && sample.button !== "primary")
    )
      continue;
    const item = hit(s, sample.x, sample.y);
    if (item >= 0) s.menuIndex = item;
    if (sample.type === "down")
      s.pointerPress = { id: sample.id, item, screen: s.screen };
    if (sample.type === "up") {
      clicked =
        item >= 0 &&
        s.pointerPress?.id === sample.id &&
        s.pointerPress.item === item &&
        s.pointerPress.screen === s.screen;
      s.pointerPress = null;
    }
  }
  return clicked || api.input.pressed("confirm") ? confirm(s) : s;
}
