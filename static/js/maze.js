import { STATE } from "./state.js";
import { ctx } from "./render.js";

export let WALL_LENGTH_MULTIPLIER = 1.04;

const WALL_THICKNESS = 5;

function isPositiveNumber(value) {
  // Validate numeric config values.
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getWallMultiplier() {
  // Resolve wall scaling multiplier.
  return isPositiveNumber(WALL_LENGTH_MULTIPLIER) ? WALL_LENGTH_MULTIPLIER : 1;
}

function rectFromHorizontalSegment(seg, thickness) {
  // Create a rect centered on a horizontal wall segment.
  const x = Math.min(seg.x1, seg.x2);
  const y = seg.y1 - thickness / 2;
  return { x, y, w: Math.abs(seg.x2 - seg.x1), h: thickness };
}

function rectFromVerticalSegment(seg, thickness) {
  // Create a rect centered on a vertical wall segment.
  const x = seg.x1 - thickness / 2;
  const y = Math.min(seg.y1, seg.y2);
  return { x, y, w: thickness, h: Math.abs(seg.y2 - seg.y1) };
}

function buildWallRectFromSegment(seg, thickness) {
  // Convert a wall segment to an AABB for collision tests.
  if (seg.y1 === seg.y2) return rectFromHorizontalSegment(seg, thickness);
  if (seg.x1 === seg.x2) return rectFromVerticalSegment(seg, thickness);

  const minX = Math.min(seg.x1, seg.x2);
  const minY = Math.min(seg.y1, seg.y2);
  return {
    x: minX,
    y: minY,
    w: Math.abs(seg.x2 - seg.x1) || thickness,
    h: Math.abs(seg.y2 - seg.y1) || thickness,
  };
}

function segmentTop(baseX, baseY, cellSize, extraX) {
  // Build a top wall segment for a cell.
  return {
    x1: baseX - extraX,
    y1: baseY,
    x2: baseX + cellSize + extraX,
    y2: baseY,
  };
}

function segmentBottom(baseX, baseY, cellSize, extraX) {
  // Build a bottom wall segment for a cell.
  return {
    x1: baseX - extraX,
    y1: baseY + cellSize,
    x2: baseX + cellSize + extraX,
    y2: baseY + cellSize,
  };
}

function segmentLeft(baseX, baseY, cellSize, extraY) {
  // Build a left wall segment for a cell.
  return {
    x1: baseX,
    y1: baseY - extraY,
    x2: baseX,
    y2: baseY + cellSize + extraY,
  };
}

function segmentRight(baseX, baseY, cellSize, extraY) {
  // Build a right wall segment for a cell.
  return {
    x1: baseX + cellSize,
    y1: baseY - extraY,
    x2: baseX + cellSize,
    y2: baseY + cellSize + extraY,
  };
}

function clearWallCache() {
  // Reset wall caches.
  STATE.wallSegments = [];
  STATE.wallRects = [];
  STATE.wallsReady = false;
}

function buildWallSegmentsForMaze() {
  // Build wall segments from the maze grid.
  const maze = STATE.maze;
  if (!maze.length) return [];

  const cellSize = STATE.cellSize;
  const mult = getWallMultiplier();
  const extraX = (cellSize * mult - cellSize) / 2;
  const extraY = (cellSize * mult - cellSize) / 2;

  const h = maze.length;
  const w = maze[0].length;

  const segments = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = maze[y][x];
      const baseX = x * cellSize;
      const baseY = y * cellSize;

      if (cell.top) segments.push(segmentTop(baseX, baseY, cellSize, extraX));
      if (cell.bottom)
        segments.push(segmentBottom(baseX, baseY, cellSize, extraX));
      if (cell.left) segments.push(segmentLeft(baseX, baseY, cellSize, extraY));
      if (cell.right)
        segments.push(segmentRight(baseX, baseY, cellSize, extraY));
    }
  }
  return segments;
}

export function rebuildWalls() {
  // Rebuild wall segments and collision rects from the current maze.
  clearWallCache();
  if (!STATE.maze.length || !ctx) return;

  ctx.lineWidth = WALL_THICKNESS;

  STATE.wallSegments = buildWallSegmentsForMaze();
  STATE.wallRects = STATE.wallSegments.map((seg) =>
    buildWallRectFromSegment(seg, ctx.lineWidth),
  );

  STATE.wallsReady = true;
}

export function getTankCorners(tank) {
  // Return the rotated rectangle corners for a tank.
  const offsetsX = [-15, 15, 15, -15];
  const offsetsY = [-10, -10, 10, 10];

  const cos = Math.cos(tank.angle);
  const sin = Math.sin(tank.angle);

  return offsetsX.map((offX, i) => ({
    x: tank.x + offX * cos - offsetsY[i] * sin,
    y: tank.y + offX * sin + offsetsY[i] * cos,
  }));
}

function tankAABB(corners) {
  // Compute an AABB around tank corners.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function projectionsOverlap(minA, maxA, minB, maxB) {
  // Check 1D projection overlap.
  return !(maxA < minB || maxB < minA);
}

function projectPolygon(axis, points) {
  // Project polygon points onto axis.
  let min = Infinity;
  let max = -Infinity;

  for (const p of points) {
    const proj = p.x * axis.x + p.y * axis.y;
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }

  return { min, max };
}

function normalize(v) {
  // Normalize a vector.
  const len = Math.hypot(v.x, v.y);
  return len ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

function buildTankAxes(tankCorners) {
  // Build SAT axes for the tank rectangle and world axes.
  const edge1 = {
    x: tankCorners[1].x - tankCorners[0].x,
    y: tankCorners[1].y - tankCorners[0].y,
  };
  const edge2 = {
    x: tankCorners[3].x - tankCorners[0].x,
    y: tankCorners[3].y - tankCorners[0].y,
  };

  return [normalize(edge1), normalize(edge2), { x: 1, y: 0 }, { x: 0, y: 1 }];
}

function rectPoints(rect) {
  // Return rectangle corner points.
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
}

function orientedRectVsAABB(tankCorners, rect) {
  // SAT collision between oriented tank rect and axis-aligned wall rect.
  const axes = buildTankAxes(tankCorners);
  const rectPts = rectPoints(rect);

  for (const axis of axes) {
    const tankProj = projectPolygon(axis, tankCorners);
    const rectProj = projectPolygon(axis, rectPts);
    if (
      !projectionsOverlap(
        tankProj.min,
        tankProj.max,
        rectProj.min,
        rectProj.max,
      )
    )
      return false;
  }

  return true;
}

function aabbIntersects(aabb, rect) {
  // Early-out AABB intersection test.
  return !(
    aabb.x + aabb.w < rect.x ||
    aabb.x > rect.x + rect.w ||
    aabb.y + aabb.h < rect.y ||
    aabb.y > rect.y + rect.h
  );
}

export function tankCollides(tank) {
  // Check tank collision against wall rects.
  if (!STATE.wallsReady) return false;

  const corners = getTankCorners(tank);
  const aabb = tankAABB(corners);

  for (const rect of STATE.wallRects) {
    if (!aabbIntersects(aabb, rect)) continue;
    if (orientedRectVsAABB(corners, rect)) return true;
  }

  return false;
}
