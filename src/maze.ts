import * as C from "./constants";
import type { Body, Direction, ReadState, TilePoint } from "./types";

export const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];
export const VECTOR: Record<Direction, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
export function center(tx: number, ty: number) {
  return {
    x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
    y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
    tx,
    ty,
  };
}
export function locate<T extends { x: number; y: number }>(
  body: T,
): T & TilePoint {
  return {
    ...body,
    tx: Math.floor((body.x - C.GRID_ORIGIN_X) / C.TILE),
    ty: Math.floor((body.y - C.GRID_ORIGIN_Y) / C.TILE),
  };
}
export function layer(char: string): string[] {
  return Array.from({ length: C.GRID_ROWS }, () => char.repeat(C.GRID_COLS));
}
export function put(
  rows: string[],
  tx: number,
  ty: number,
  char: string,
): void {
  const row = rows[ty];
  if (row !== undefined && tx >= 0 && tx < C.GRID_COLS)
    rows[ty] = row.slice(0, tx) + char + row.slice(tx + 1);
}
/** A mirrored network of loops; the only wide chamber is the sealed den. */
export function makeMaze(): string[] {
  const rows = layer("#");
  const columns = [1, 4, 7, 10, 13, 22, 25, 28, 31, 34];
  for (let y = 1; y < C.GRID_ROWS - 1; y++) {
    for (const x of columns) put(rows, x, y, ".");
  }
  for (const y of [1, 5, 11, 13, 16])
    for (let x = 1; x < C.GRID_COLS - 1; x++) put(rows, x, y, ".");
  for (const y of [3, 8])
    for (let x = 1; x < C.GRID_COLS - 1; x++) {
      if (x <= 13 || x >= 22) put(rows, x, y, ".");
    }
  put(rows, 0, 8, ".");
  put(rows, C.GRID_COLS - 1, 8, ".");
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  return rows;
}
export function tile(
  s: Pick<ReadState, "tiles">,
  tx: number,
  ty: number,
): string {
  return s.tiles[ty]?.[tx] ?? "#";
}
export function wrapRow(s: Pick<ReadState, "tiles">): number {
  return s.tiles.findIndex((r) => r[0] === "." && r[C.GRID_COLS - 1] === ".");
}
export function neighbor(
  s: Pick<ReadState, "tiles">,
  tx: number,
  ty: number,
  dir: Direction,
): TilePoint {
  const [dx, dy] = VECTOR[dir];
  let x = tx + dx;
  if (ty === wrapRow(s) && dy === 0) x = (x + C.GRID_COLS) % C.GRID_COLS;
  return { tx: x, ty: ty + dy };
}
export function open(
  s: Pick<ReadState, "tiles">,
  tx: number,
  ty: number,
  den = false,
): boolean {
  const t = tile(s, tx, ty);
  return t === "." || (den && (t === "d" || t === "g"));
}
export function exits(
  s: Pick<ReadState, "tiles">,
  b: TilePoint,
  den = false,
): Direction[] {
  return DIRECTIONS.filter((d) => {
    const n = neighbor(s, b.tx, b.ty, d);
    return open(s, n.tx, n.ty, den);
  });
}
export function distances(
  s: Pick<ReadState, "tiles">,
  origin: TilePoint,
  den = false,
): number[] {
  const result = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(-1);
  if (!open(s, origin.tx, origin.ty, den)) return result;
  const queue: TilePoint[] = [origin];
  result[origin.ty * C.GRID_COLS + origin.tx] = 0;
  for (let i = 0; i < queue.length; i++) {
    const b = queue[i]!;
    const depth = result[b.ty * C.GRID_COLS + b.tx]!;
    for (const dir of exits(s, b, den)) {
      const n = neighbor(s, b.tx, b.ty, dir),
        index = n.ty * C.GRID_COLS + n.tx;
      if (result[index] === -1) {
        result[index] = depth + 1;
        queue.push(n);
      }
    }
  }
  return result;
}
export function route(
  s: Pick<ReadState, "tiles">,
  b: Body,
  goal: TilePoint,
  den = false,
): Direction | null {
  if (b.tx === goal.tx && b.ty === goal.ty) return null;
  const map = distances(s, goal, den);
  let best = Infinity,
    choice: Direction | null = null;
  for (const dir of exits(s, b, den)) {
    const n = neighbor(s, b.tx, b.ty, dir),
      distance = map[n.ty * C.GRID_COLS + n.tx]!;
    if (distance >= 0 && distance < best) {
      best = distance;
      choice = dir;
    }
  }
  return choice;
}
export function atCenter(b: Body): boolean {
  const c = center(b.tx, b.ty);
  return Math.abs(b.x - c.x) < 1e-6 && Math.abs(b.y - c.y) < 1e-6;
}
/** Travel consumes its whole distance, splitting exactly at centers and borders. */
export function move<T extends Body>(
  s: Pick<ReadState, "tiles">,
  original: T,
  distance: number,
  choose: (body: T) => Direction | null,
  den = false,
  reverse: Direction | null = null,
): T {
  let b = { ...original };
  if (!open(s, b.tx, b.ty, den)) return b;
  if (reverse === OPPOSITE[b.dir]) b.dir = reverse;
  while (distance > 1e-8) {
    const c = center(b.tx, b.ty);
    if (atCenter(b)) {
      const dir = choose(b);
      if (dir === null) break;
      const n = neighbor(s, b.tx, b.ty, dir);
      if (!open(s, n.tx, n.ty, den)) break;
      b.dir = dir;
    }
    const [dx, dy] = VECTOR[b.dir];
    let gap: number;
    if (dx) gap = dx > 0 ? c.x - b.x : b.x - c.x;
    else gap = dy > 0 ? c.y - b.y : b.y - c.y;
    if (gap <= 1e-7) gap += C.TILE;
    const n = neighbor(s, b.tx, b.ty, b.dir);
    const aheadOfCenter = dx
      ? (b.x - c.x) * dx >= -1e-7
      : (b.y - c.y) * dy >= -1e-7;
    if (aheadOfCenter && !open(s, n.tx, n.ty, den)) break;
    const step = Math.min(distance, gap);
    b.x += dx * step;
    b.y += dy * step;
    distance -= step;
    const width = C.GRID_COLS * C.TILE;
    if (b.ty === wrapRow(s)) {
      if (b.x < C.GRID_ORIGIN_X) b.x += width;
      if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    }
    b = locate(b);
  }
  return b;
}
/** Grid DDA: visit every tile crossed by a segment, including diagonal corners. */
export function lineClear(
  s: Pick<ReadState, "tiles">,
  a: { x: number; y: number },
  b: { x: number; y: number },
  revealRock = false,
): boolean {
  const start = locate(a),
    end = locate(b);
  let x = start.tx,
    y = start.ty;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    sx = Math.sign(dx),
    sy = Math.sign(dy);
  const stepX = dx === 0 ? Infinity : C.TILE / Math.abs(dx);
  const stepY = dy === 0 ? Infinity : C.TILE / Math.abs(dy);
  let nextX =
    dx === 0
      ? Infinity
      : (C.GRID_ORIGIN_X + (x + (sx > 0 ? 1 : 0)) * C.TILE - a.x) / dx;
  let nextY =
    dy === 0
      ? Infinity
      : (C.GRID_ORIGIN_Y + (y + (sy > 0 ? 1 : 0)) * C.TILE - a.y) / dy;
  for (let steps = 0; steps < C.GRID_COLS + C.GRID_ROWS + 4; steps++) {
    if (tile(s, x, y) === "#" && !(revealRock && x === end.tx && y === end.ty))
      return false;
    if (x === end.tx && y === end.ty) return true;
    if (Math.abs(nextX - nextY) < 1e-10) {
      if (tile(s, x + sx, y) === "#" || tile(s, x, y + sy) === "#")
        return false;
      x += sx;
      y += sy;
      nextX += stepX;
      nextY += stepY;
    } else if (nextX < nextY) {
      x += sx;
      nextX += stepX;
    } else {
      y += sy;
      nextY += stepY;
    }
  }
  return false;
}
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function sameTile(a: TilePoint, b: TilePoint): boolean {
  return a.tx === b.tx && a.ty === b.ty;
}
export function segmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
