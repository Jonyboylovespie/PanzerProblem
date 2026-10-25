import { steerMisile } from "./misile.js";

const EPSILON = 1e-9;
const WALL_CLEARANCE = 0.01;

function firstWallHit(x, y, dx, dy, walls, queryWalls) {
  let closest = null;
  const minX = Math.min(x, x + dx);
  const maxX = Math.max(x, x + dx);
  const minY = Math.min(y, y + dy);
  const maxY = Math.max(y, y + dy);
  const candidates = queryWalls ? queryWalls(minX, minY, maxX, maxY) : walls;
  for (const wall of candidates) {
    if (maxX < wall.x || minX > wall.x + wall.w ||
        maxY < wall.y || minY > wall.y + wall.h) continue;
    let enter = 0;
    let leave = 1;
    let nx = 0;
    let ny = 0;
    for (const [origin, delta, low, high, axis] of [
      [x, dx, wall.x, wall.x + wall.w, "x"],
      [y, dy, wall.y, wall.y + wall.h, "y"],
    ]) {
      if (Math.abs(delta) < EPSILON) {
        if (origin < low || origin > high) {
          enter = 2;
          break;
        }
        continue;
      }
      const near = Math.min((low - origin) / delta, (high - origin) / delta);
      const far = Math.max((low - origin) / delta, (high - origin) / delta);
      if (near > enter + EPSILON) {
        nx = 0;
        ny = 0;
      }
      if (near >= enter - EPSILON) {
        if (axis === "x") nx = -Math.sign(delta);
        else ny = -Math.sign(delta);
      }
      enter = Math.max(enter, near);
      leave = Math.min(leave, far);
    }
    // Ignore a surface we are already moving away from.
    if (enter > leave || leave <= 0) continue;
    if (!closest || enter < closest.fraction - EPSILON) {
      closest = { fraction: enter, nx, ny };
    } else if (Math.abs(enter - closest.fraction) < EPSILON) {
      closest.nx ||= nx;
      closest.ny ||= ny;
    }
  }
  return closest;
}

export function stepBullet(bullet, deltaSeconds, walls, queryWalls = null, path = null,
                           tanks = {}, maze = null, cellSize = 70) {
  steerMisile(bullet, deltaSeconds, tanks, maze, cellSize);
  let nextX = bullet.x;
  let nextY = bullet.y;
  let remaining = deltaSeconds;
  // Normal substeps travel at most five pixels; the bound also protects against
  // degenerate overlapping walls trapping a projectile in an endless bounce.
  for (let bounce = 0; bounce < 4 && remaining > 0; bounce++) {
    const dx = bullet.vx * remaining;
    const dy = bullet.vy * remaining;
    const hit = firstWallHit(nextX, nextY, dx, dy, walls, queryWalls);
    if (!hit) {
      nextX += dx;
      nextY += dy;
      path?.push({ x: nextX, y: nextY });
      return { nextX, nextY, hitWall: false };
    }

    // Trace the entire step so a diagonal or fast shot cannot skip a thin wall.
    nextX += dx * hit.fraction + hit.nx * WALL_CLEARANCE;
    nextY += dy * hit.fraction + hit.ny * WALL_CLEARANCE;
    path?.push({ x: nextX, y: nextY });
    if (bullet.weapon_type === "fragment" || (!hit.nx && !hit.ny)) {
      return { nextX, nextY, hitWall: true };
    }
    if (hit.nx) bullet.vx = -bullet.vx;
    if (hit.ny) bullet.vy = -bullet.vy;
    // Use the rest of the frame after impact, independent of display refresh.
    remaining *= 1 - hit.fraction;
  }
  path?.push({ x: nextX, y: nextY });
  return { nextX, nextY, hitWall: false };
}

export function bulletSpawnPosition(tank, walls, queryWalls = null) {
  // Match the server's sweep to the 25px muzzle, including near-wall clearance.
  const dx = 25 * Math.cos(tank.angle);
  const dy = 25 * Math.sin(tank.angle);
  const hit = firstWallHit(tank.x, tank.y, dx, dy, walls, queryWalls);
  const fraction = hit ? Math.max(0, hit.fraction - WALL_CLEARANCE / 25) : 1;
  return { x: tank.x + dx * fraction, y: tank.y + dy * fraction };
}
