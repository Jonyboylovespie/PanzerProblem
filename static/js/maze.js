import { STATE } from "./state.js";
import { ctx } from "./render.js";
// Multiplier controlling wall segment length relative to a single cell.
export let WALL_LENGTH_MULTIPLIER = 1.04;
function buildWallRectFromSegment(seg, thickness) {
  if (seg.y1 === seg.y2) { const y = seg.y1 - thickness/2; return { x: Math.min(seg.x1, seg.x2), y, w: Math.abs(seg.x2 - seg.x1), h: thickness }; }
  if (seg.x1 === seg.x2) { const x = seg.x1 - thickness/2; return { x, y: Math.min(seg.y1, seg.y2), w: thickness, h: Math.abs(seg.y2 - seg.y1) }; }
  const minX = Math.min(seg.x1, seg.x2), minY = Math.min(seg.y1, seg.y2);
  return { x: minX, y: minY, w: Math.abs(seg.x2 - seg.x1) || thickness, h: Math.abs(seg.y2 - seg.y1) || thickness };
}
export function rebuildWalls() {
  STATE.wallSegments = [];
  STATE.wallRects = [];
  STATE.wallsReady = false;
  if (!STATE.maze.length) return;
  ctx.lineWidth = 5;
  const h = STATE.maze.length,
    w = STATE.maze[0].length;
  // Allow scaling the logical wall segment length relative to a single cell.
  const cellSize = STATE.cellSize;
  // Use a top-level editable multiplier instead of storing this in STATE.
  const mult =
    typeof WALL_LENGTH_MULTIPLIER === "number" && WALL_LENGTH_MULTIPLIER > 0
      ? WALL_LENGTH_MULTIPLIER
      : 1;
  const wallLenX = cellSize * mult;
  const extraX = (wallLenX - cellSize) / 2;
  const wallLenY = cellSize * mult;
  const extraY = (wallLenY - cellSize) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = STATE.maze[y][x];
      const baseX = x * cellSize,
        baseY = y * cellSize;
      // Horizontal walls (top/bottom): extend along X by extraX (centered)
      const topX1 = baseX - extraX,
        topY = baseY,
        topX2 = baseX + cellSize + extraX;
      const bottomX1 = baseX - extraX,
        bottomY = baseY + cellSize,
        bottomX2 = baseX + cellSize + extraX;
      // Vertical walls (left/right): extend along Y by extraY (centered)
      const leftX = baseX,
        leftY1 = baseY - extraY,
        leftY2 = baseY + cellSize + extraY;
      const rightX = baseX + cellSize,
        rightY1 = baseY - extraY,
        rightY2 = baseY + cellSize + extraY;
      if (cell.top)
        STATE.wallSegments.push({ x1: topX1, y1: topY, x2: topX2, y2: topY });
      if (cell.right)
        STATE.wallSegments.push({
          x1: rightX,
          y1: rightY1,
          x2: rightX,
          y2: rightY2,
        });
      if (cell.bottom)
        STATE.wallSegments.push({
          x1: bottomX1,
          y1: bottomY,
          x2: bottomX2,
          y2: bottomY,
        });
      if (cell.left)
        STATE.wallSegments.push({
          x1: leftX,
          y1: leftY1,
          x2: leftX,
          y2: leftY2,
        });
    }
  }
  for (const seg of STATE.wallSegments)
    STATE.wallRects.push(buildWallRectFromSegment(seg, ctx.lineWidth));
  STATE.wallsReady = true;
}
export function getTankCorners(tank) {
  const dx = [-15, 15, 15, -15],
    dy = [-10, -10, 10, 10];
  const cos = Math.cos(tank.angle),
    sin = Math.sin(tank.angle);
  return dx.map((offX, i) => ({
    x: tank.x + offX * cos - dy[i] * sin,
    y: tank.y + offX * sin + dy[i] * cos,
  }));
}
function tankAABB(corners) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function projectionsOverlap(minA, maxA, minB, maxB) {
  return !(maxA < minB || maxB < minA);
}
function projectPolygon(axis, points) {
  let min = Infinity,
    max = -Infinity;
  for (const p of points) {
    const proj = p.x * axis.x + p.y * axis.y;
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  return { min, max };
}
function normalize(v) {
  const len = Math.hypot(v.x, v.y);
  return len ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}
function orientedRectVsAABB(tankCorners, rect) {
  const axes = [];
  const e1 = {
    x: tankCorners[1].x - tankCorners[0].x,
    y: tankCorners[1].y - tankCorners[0].y,
  };
  const e2 = {
    x: tankCorners[3].x - tankCorners[0].x,
    y: tankCorners[3].y - tankCorners[0].y,
  };
  axes.push(normalize(e1));
  axes.push(normalize(e2));
  axes.push({ x: 1, y: 0 });
  axes.push({ x: 0, y: 1 });
  const rectPts = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  for (const axis of axes) {
    const projTank = projectPolygon(axis, tankCorners);
    const projRect = projectPolygon(axis, rectPts);
    if (
      !projectionsOverlap(
        projTank.min,
        projTank.max,
        projRect.min,
        projRect.max,
      )
    )
      return false;
  }
  return true;
}
export function tankCollides(tank) {
  if (!STATE.wallsReady) return false;
  const corners = getTankCorners(tank);
  const aabb = tankAABB(corners);
  for (const rect of STATE.wallRects) {
    if (
      aabb.x + aabb.w < rect.x ||
      aabb.x > rect.x + rect.w ||
      aabb.y + aabb.h < rect.y ||
      aabb.y > rect.y + rect.h
    )
      continue;
    if (orientedRectVsAABB(corners, rect)) return true;
  }
  return false;
}
