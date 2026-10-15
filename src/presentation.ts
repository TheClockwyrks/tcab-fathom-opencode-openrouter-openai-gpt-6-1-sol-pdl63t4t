import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import {
  center,
  DIRECTIONS,
  distance,
  distances,
  neighbor,
  tile,
} from "./maze";
import { menuItemRect, menuItems } from "./menus";
import { COUNTDOWN_TIME, isLoose } from "./world";
import type { Direction, ReadState } from "./types";

export const BACKGROUND = "#03080e";
const CYAN = "#80f9e4",
  WHITE = "#e2f4ef",
  DIM = "#6c8a94",
  AMBER = "#ff935a";
const MONO = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
type Context = CanvasRenderingContext2D;
const facing: Record<Direction, number> = { down: 0, up: 2, left: 4, right: 6 };
function text(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size = 14,
  color = DIM,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `${size >= 40 ? "600" : "400"} ${size}px ${MONO}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}
function tracked(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  spacing = 4,
  size = 12,
  color = DIM,
): void {
  for (const letter of value) {
    text(ctx, letter, x, y, size, color);
    x += size * 0.61 + spacing;
  }
}
function line(
  ctx: Context,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = "#19333d",
  width = 1,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(
  ctx: Context,
  x: number,
  y: number,
  radius: number,
  color: string,
  width = 1,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}
function glow(
  ctx: Context,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
function sprite(
  ctx: Context,
  s: ReadState,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
): void {
  const image = s.art[sheet]?.[frame];
  if (image) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
}
function amber(ctx: Context, x: number, y: number): void {
  glow(ctx, x, y, 22, "#ef713b65");
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe4b5";
  ctx.fillRect(x - 1, y - 1, 2, 2);
}
function wallFrame(s: ReadState, tx: number, ty: number): number {
  return (
    (tile(s, tx, ty - 1) === "#" ? 1 : 0) +
    (tile(s, tx + 1, ty) === "#" ? 2 : 0) +
    (tile(s, tx, ty + 1) === "#" ? 4 : 0) +
    (tile(s, tx - 1, ty) === "#" ? 8 : 0)
  );
}
function terrain(ctx: Context, s: ReadState, decorative = false): void {
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const visibility = s.visibility[ty]![tx];
      if (!decorative && visibility === "u") continue;
      const t = tile(s, tx, ty),
        c = center(tx, ty);
      const frame = t === "#" ? wallFrame(s, tx, ty) : t === "g" ? 18 : 16;
      ctx.globalAlpha = decorative ? 0.58 : visibility === "l" ? 1 : 0.32;
      sprite(ctx, s, "trench-walls", frame, c.x, c.y);
      if (s.plankton[ty]?.[tx] === "*") {
        ctx.globalAlpha = decorative ? 0.45 : visibility === "l" ? 1 : 0.23;
        ctx.fillStyle = "#b2f7d8";
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = visibility === "l" ? 9 : 0;
        ctx.beginPath();
        ctx.arc(c.x, c.y, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  ctx.globalAlpha = 1;
}
function mazeClip(ctx: Context): void {
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
}
function world(ctx: Context, s: ReadState): void {
  const f = s.forager;
  ctx.save();
  mazeClip(ctx);
  const fog = s.art["trench-walls"]?.[17];
  if (fog)
    ctx.drawImage(
      fog,
      C.GRID_ORIGIN_X,
      C.GRID_ORIGIN_Y,
      C.GRID_COLS * C.TILE,
      C.GRID_ROWS * C.TILE,
    );
  const flares = s.predators.filter((p) => p.flaring && isLoose(s, p));
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, s.windowRadius, 0, Math.PI * 2);
  for (const p of flares) {
    ctx.moveTo(p.x + C.FLARE_RADIUS, p.y);
    ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
  }
  ctx.clip();
  terrain(ctx, s);
  glow(ctx, f.x, f.y, s.windowRadius, "#2cd9c91b");
  glow(ctx, f.x, f.y, s.visionRadius, "#5fffe419");
  for (const cloud of s.inkClouds) {
    const g = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      cloud.radius * 0.5,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    g.addColorStop(0, "#000108f7");
    g.addColorStop(0.8, "#000108dd");
    g.addColorStop(1, "#00010800");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
    ctx.fill();
    circle(ctx, cloud.x, cloud.y, cloud.radius * 0.85, "#645e9a20");
  }
  for (const d of s.drifters)
    if (d.lit)
      sprite(
        ctx,
        s,
        "drifter",
        d.mind && d.travel ? Math.floor(s.playTime * 8) % 8 : 0,
        d.x,
        d.y,
      );
  // Amber points are limited by the true circle, independently of tile visibility.
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, s.windowRadius, 0, Math.PI * 2);
  ctx.clip();
  for (const d of s.drifters) amber(ctx, d.x, d.y);
  for (const p of s.predators)
    if (isLoose(s, p) && p.kind === "lanternjaw") amber(ctx, p.x, p.y);
  ctx.restore();
  ctx.restore();
  for (const p of s.predators) {
    if (!isLoose(s, p) || p.kind !== "flarefish") continue;
    let frame = -1,
      size = C.FLARE_RADIUS * 2;
    if (p.flareCharging) {
      frame = Math.min(2, Math.floor((p.flareTime / C.FLARE_CHARGE) * 3));
      size *= 0.35;
    } else if (p.flaring)
      frame = 3 + Math.min(2, Math.floor((p.flareTime / C.FLARE_BLOOM) * 3));
    else if (p.flareFade > 0) frame = p.flareFade > 0.175 ? 6 : 7;
    if (frame >= 0) sprite(ctx, s, "flare-bloom", frame, p.x, p.y, size);
  }
  for (const p of s.predators) {
    if (!isLoose(s, p)) continue;
    if (p.lit) {
      ctx.globalAlpha =
        p.markLeft > 0 &&
        !p.alert &&
        distance(p, f) > s.visionRadius &&
        !flares.some((flare) => distance(flare, p) <= C.FLARE_RADIUS)
          ? Math.min(1, p.markLeft / 0.4)
          : 1;
      const frame =
        p.kind === "lanternjaw" && p.state !== "chase"
          ? 8 + (p.mind && p.travel ? Math.floor(s.playTime * 8) % 8 : 0)
          : facing[p.dir] +
            (p.mind && p.travel ? Math.floor(s.playTime * 7) % 2 : 0);
      sprite(ctx, s, p.kind, frame, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    if (p.alert) {
      const progress = 1 - p.alertLeft / C.ALERT_TIME,
        color = p.kind === "gloamfin" ? "#c5a1ff" : "#ffbc7d";
      ctx.globalAlpha = 1 - progress;
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4,
          r = 17 + progress * 30;
        line(
          ctx,
          p.x + Math.cos(a) * r,
          p.y + Math.sin(a) * r,
          p.x + Math.cos(a) * (r + 9),
          p.y + Math.sin(a) * (r + 9),
          color,
          2,
        );
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }
  for (const p of s.pulses) {
    const map = distances(s, { tx: p.ox, ty: p.oy });
    const color =
      p.tint === "cyan" ? CYAN : p.tint === "violet" ? "#b18aff" : "#ff9d56";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let ty = 0; ty < C.GRID_ROWS; ty++)
      for (let tx = 0; tx < C.GRID_COLS; tx++) {
        const d = map[ty * C.GRID_COLS + tx]!;
        if (d < 0 || d > p.range || Math.abs(d - p.front) > 1.25) continue;
        const c = center(tx, ty),
          intensity = Math.max(0, 1 - Math.abs(d - p.front) / 1.25);
        ctx.globalAlpha = intensity * 0.15;
        ctx.fillRect(c.x - 12, c.y - 12, 24, 24);
        ctx.globalAlpha = intensity * 0.9;
        for (const dir of DIRECTIONS) {
          const n = neighbor(s, tx, ty, dir),
            nd = map[n.ty * C.GRID_COLS + n.tx] ?? -1;
          if (nd !== d + 1) continue;
          const nc = center(n.tx, n.ty);
          if (distance(c, nc) > C.TILE + 1) continue;
          const t = Math.max(-0.45, Math.min(0.45, p.front - d));
          const x = c.x + (nc.x - c.x) * t,
            y = c.y + (nc.y - c.y) * t;
          ctx.beginPath();
          if (nc.x !== c.x) {
            ctx.moveTo(x, y - 11);
            ctx.lineTo(x, y + 11);
          } else {
            ctx.moveTo(x - 11, y);
            ctx.lineTo(x + 11, y);
          }
          ctx.stroke();
        }
      }
    ctx.restore();
  }
  glow(ctx, f.x, f.y, 35 + s.brightness * 14, "#7cffe75e");
  sprite(
    ctx,
    s,
    "glimmerfin",
    facing[f.dir] + (f.moving ? Math.floor(s.playTime * 9) % 2 : 0),
    f.x,
    f.y,
  );
  ctx.restore();
}
function gauge(
  ctx: Context,
  x: number,
  label: string,
  key: string,
  value: number,
  color: string,
): void {
  text(ctx, key, x, 681, 12, color);
  text(ctx, label, x + 52, 681, 12, WHITE);
  ctx.fillStyle = "#14232d";
  ctx.fillRect(x, 699, 177, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x, 699, 177 * Math.max(0, Math.min(1, value)), 3);
  text(
    ctx,
    value >= 1 ? "READY" : "CHARGING",
    x + 177,
    681,
    10,
    value >= 1 ? color : DIM,
    "right",
  );
}
function hud(ctx: Context, s: ReadState): void {
  text(ctx, s.score.toString().padStart(6, "0"), 64, 43, 48, WHITE);
  tracked(ctx, "BIOMASS", 272, 46, 2, 10);
  tracked(ctx, C.TITLE_TEXT, 566, 31, 5, 19, CYAN);
  tracked(ctx, C.DIVE_LABEL, 603, 56, 3, 10);
  text(
    ctx,
    `${s.planktonRemaining.toString().padStart(3, "0")} MOTES LEFT`,
    1216,
    32,
    13,
    WHITE,
    "right",
  );
  text(
    ctx,
    `GLOW ${Math.round(s.brightness * 100)
      .toString()
      .padStart(3, "0")}%  /  ${s.muted ? "MUTED" : "M SOUND"}`,
    1216,
    54,
    11,
    DIM,
    "right",
  );
  line(ctx, 64, 74, 1216, 74);
  line(ctx, 64, 659, 1216, 659);
  text(ctx, `DEPTH ${s.depth}`, 64, 688, 17, WHITE);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 232 + i * 27, 688, 23);
  text(ctx, "RESERVE", 218, 711, 9);
  gauge(
    ctx,
    431,
    "SONAR",
    "SPACE",
    1 - s.sonar.cooldown / C.SONAR_COOLDOWN,
    CYAN,
  );
  gauge(
    ctx,
    657,
    "INK",
    "SHIFT",
    1 - s.ink.cooldown / C.INK_COOLDOWN,
    "#b7a4f6",
  );
  text(ctx, "WASD / ARROWS  MOVE", 1216, 681, 11, DIM, "right");
  text(ctx, "ESC  PAUSE", 1216, 702, 11, DIM, "right");
}
function menu(ctx: Context, s: ReadState): void {
  menuItems(s).forEach((item, i) => {
    const r = menuItemRect(s, i)!,
      selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#12312f" : "#09151d";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#63cabb" : "#1b303b";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(r.x, r.y, 3, r.h);
    }
    text(
      ctx,
      selected ? ">" : "·",
      r.x + 22,
      r.y + r.h / 2,
      18,
      selected ? CYAN : DIM,
    );
    tracked(ctx, item, r.x + 51, r.y + r.h / 2, 2, 15, selected ? WHITE : DIM);
    if (selected)
      text(ctx, "↵", r.x + r.w - 25, r.y + r.h / 2, 18, CYAN, "center");
  });
}
function particles(ctx: Context): void {
  for (let i = 0; i < 85; i++) {
    const x = (i * 179 + 41) % C.STAGE_W,
      y = (i * 97 + 53) % C.STAGE_H;
    ctx.fillStyle = i % 4 ? "#54878529" : "#92d2c84a";
    ctx.fillRect(x, y, i % 4 ? 1 : 2, 1);
  }
}
function title(ctx: Context, s: ReadState): void {
  glow(ctx, 893, 330, 460, "#0f5c5826");
  particles(ctx);
  tracked(ctx, "F / ABYSSAL FIELD NOTES", 68, 47, 2, 11, "#8cafad");
  text(ctx, "01 — KINDLE", 1211, 47, 12, DIM, "right");
  line(ctx, 64, 72, 1216, 72);
  tracked(ctx, "A BIOLUMINESCENT MAZE CHASE", 110, 172, 2, 11, CYAN);
  ctx.save();
  ctx.shadowColor = "#63e6cf55";
  ctx.shadowBlur = 30;
  text(ctx, C.TITLE_TEXT, 100, 266, 111, WHITE);
  ctx.restore();
  tracked(ctx, C.TAGLINE_TEXT, 112, 343, 7, 14, CYAN);
  text(ctx, "Your light is a lifeline.", 112, 389, 16, "#9fb7bb");
  text(ctx, "And something is following it.", 112, 414, 16, "#9fb7bb");
  ctx.save();
  ctx.beginPath();
  ctx.arc(911, 338, 221, 0, Math.PI * 2);
  ctx.clip();
  ctx.save();
  ctx.translate(355, 13);
  terrain(ctx, s, true);
  ctx.restore();
  glow(ctx, 911, 338, 220, "#49e4cc1d");
  const shade = ctx.createRadialGradient(911, 338, 70, 911, 338, 222);
  shade.addColorStop(0, "transparent");
  shade.addColorStop(1, "#03080edb");
  ctx.fillStyle = shade;
  ctx.fillRect(680, 100, 460, 480);
  sprite(ctx, s, "glimmerfin", 6, 910, 338);
  glow(ctx, 910, 338, 49, "#6fffe264");
  amber(ctx, 1010, 243);
  amber(ctx, 815, 432);
  ctx.restore();
  circle(ctx, 911, 338, 221, "#2b746755");
  circle(ctx, 911, 338, 238, "#20443f66");
  ctx.save();
  ctx.setLineDash([2, 13]);
  circle(ctx, 911, 338, 250, "#53817a65");
  ctx.restore();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    line(
      ctx,
      911 + Math.cos(a) * 233,
      338 + Math.sin(a) * 233,
      911 + Math.cos(a) * 259,
      338 + Math.sin(a) * 259,
      "#6ed5bf77",
    );
  }
  line(ctx, 922, 338, 973, 367, "#8ae8d66b");
  line(ctx, 973, 367, 1083, 367, "#8ae8d66b");
  text(ctx, "YOU ARE THE LIGHT", 984, 386, 10, CYAN);
  tracked(ctx, "SONAR SURVEY / 001", 787, 621, 2, 10, DIM);
  menu(ctx, s);
  text(ctx, "↑ ↓  SELECT     ENTER  CONFIRM", 112, 590, 11, DIM);
  line(ctx, 64, 652, 1216, 652);
  tracked(ctx, "THE DEEP REMEMBERS. SO SHOULD YOU.", 68, 686, 2, 10, "#7d9a9c");
  text(
    ctx,
    `${s.muted ? "M  SOUND OFF" : "M  SOUND ON"}     ·     HEADPHONES RECOMMENDED`,
    1216,
    686,
    10,
    DIM,
    "right",
  );
}
function howto(ctx: Context, s: ReadState): void {
  particles(ctx);
  tracked(ctx, "FIELD GUIDE / KINDLE", 80, 53, 3, 12, CYAN);
  line(ctx, 80, 80, 1200, 80);
  text(ctx, "READ THE DARK", 80, 135, 45, WHITE);
  text(
    ctx,
    "Eat to see further. Glow too brightly, and the hunters see you.",
    80,
    185,
    16,
    "#acc2c4",
  );
  const cards = [
    {
      sheet: "lanternjaw",
      frame: 6,
      name: "01  LANTERNJAW",
      color: AMBER,
      lines: [
        "Follows your light through open water.",
        "An amber glimmer could be dinner…",
        "or jaws wearing a jellyfish disguise.",
      ],
    },
    {
      sheet: "gloamfin",
      frame: 6,
      name: "02  GLOAMFIN",
      color: "#bb9af9",
      lines: [
        "Eyeless. Listens through rock and ink.",
        "Your sonar gives you away. Its violet",
        "ping listens; orange means it lost you.",
      ],
    },
    {
      sheet: "flarefish",
      frame: 6,
      name: "03  FLAREFISH",
      color: "#ffc181",
      lines: [
        "Hunts light. Vanishes between flares.",
        "A warm charge warns of a sudden bloom.",
        "If the flash finds you, keep moving.",
      ],
    },
  ];
  cards.forEach((card, i) => {
    const x = 80 + i * 382;
    ctx.fillStyle = "#0a1720";
    ctx.fillRect(x, 236, 356, 205);
    line(ctx, x, 236, x + 356, 236, card.color);
    sprite(ctx, s, card.sheet, card.frame, x + 34, 279);
    text(ctx, card.name, x + 65, 279, 15, card.color);
    card.lines.forEach((l, n) =>
      text(ctx, l, x + 17, 337 + n * 27, 13, "#aac1c4"),
    );
  });
  text(ctx, "WASD / ARROWS", 80, 489, 14, CYAN);
  text(
    ctx,
    "Swim. Release to stop; turn at corridor centers.",
    290,
    489,
    14,
    WHITE,
  );
  text(ctx, "SPACE / SONAR", 80, 526, 14, CYAN);
  text(
    ctx,
    "Reveal winding passages. Remembered ground stays dim.",
    290,
    526,
    14,
    WHITE,
  );
  text(ctx, "SHIFT / INK", 80, 563, 14, "#bb9af9");
  text(
    ctx,
    "Blind the light-hunters. The listener still hears you.",
    290,
    563,
    14,
    WHITE,
  );
  text(ctx, "ESC / P  PAUSE     M  MUTE", 80, 610, 12, DIM);
  text(
    ctx,
    "Only your growing vision circle shows remembered terrain. Clear every mote to descend.",
    80,
    648,
    13,
    DIM,
  );
  line(ctx, 80, 674, 1200, 674);
  text(
    ctx,
    "ENTER / ESC / CLICK ANYWHERE TO RETURN",
    640,
    700,
    12,
    CYAN,
    "center",
  );
}
function panel(ctx: Context, heading: string, subheading: string): void {
  ctx.fillStyle = "#03080ed9";
  ctx.fillRect(0, 80, C.STAGE_W, 576);
  ctx.fillStyle = "#08151df5";
  ctx.fillRect(397, 192, 486, 409);
  line(ctx, 397, 192, 883, 192, "#487e75");
  tracked(ctx, "ABYSSAL TRANSMISSION", 505, 233, 3, 10, DIM);
  text(ctx, heading, 640, 291, 40, WHITE, "center");
  text(ctx, subheading, 640, 331, 13, CYAN, "center");
}
export function render(s: ReadState, api: RenderApi): void {
  const ctx = api.ctx;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  if (s.screen === "title") title(ctx, s);
  else if (s.screen === "howto") howto(ctx, s);
  else if (s.screen === "gameover") {
    particles(ctx);
    glow(ctx, 640, 330, 330, "#174d491f");
    tracked(ctx, C.TITLE_TEXT, 71, 46, 4, 17, CYAN);
    panel(
      ctx,
      "SIGNAL LOST",
      `SCORE ${s.score.toString().padStart(6, "0")}    /    DEPTH ${s.depth}`,
    );
    menu(ctx, s);
    text(ctx, "The deep keeps what it catches.", 640, 623, 13, DIM, "center");
  } else {
    world(ctx, s);
    hud(ctx, s);
    if (s.screen === "paused") {
      panel(ctx, "SUSPENDED", "YOUR LIGHT HOLDS. THE DEEP WAITS.");
      menu(ctx, s);
    } else if (s.screen === "countdown" || s.screen === "cleared") {
      ctx.fillStyle = "#03080e9c";
      ctx.fillRect(410, 258, 460, 186);
      line(ctx, 462, 259, 818, 259, "#467f75");
      text(
        ctx,
        s.screen === "countdown"
          ? C.TITLE_ITEMS[0]
          : `DEPTH ${s.depth} CLEARED`,
        640,
        313,
        s.screen === "countdown" ? 52 : 32,
        WHITE,
        "center",
      );
      text(
        ctx,
        s.screen === "countdown"
          ? `${Math.max(1, Math.ceil((COUNTDOWN_TIME - s.screenTime) / (COUNTDOWN_TIME / 3)))}`
          : `+${C.SCORE_CLEAR}  /  DESCENDING`,
        640,
        371,
        s.screen === "countdown" ? 33 : 16,
        CYAN,
        "center",
      );
      text(
        ctx,
        s.screen === "countdown"
          ? "KEEP YOUR LIGHT. WATCH THE GLIMMERS."
          : "THERE IS ALWAYS SOMETHING DEEPER.",
        640,
        418,
        10,
        DIM,
        "center",
      );
    }
  }
  ctx.restore();
}
