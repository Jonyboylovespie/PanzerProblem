export const MISILE_SPEED = 240;
export const MISILE_HOMING_DELAY = 2;
export const MISILE_HOMING_DURATION = 5;
export const MISILE_TURN_RATE = 3.2;

const DIRECTIONS = [
  { dx: 1, dy: 0, wall: "right", opposite: "left" },
  { dx: 0, dy: 1, wall: "bottom", opposite: "top" },
  { dx: -1, dy: 0, wall: "left", opposite: "right" },
  { dx: 0, dy: -1, wall: "top", opposite: "bottom" },
];
const mazeGeometry = new WeakMap();
const routes = new WeakMap();
const NAV_CLEARANCE = 6;

function geometryFor(maze, cellSize) {
  let geometry = mazeGeometry.get(maze);
  if (geometry?.cellSize === cellSize) return geometry;
  const walls = [];
  // Match the game's 5px walls and their overlapping ends. Extra clearance
  // keeps the missile's body away from corners when choosing a shortcut.
  const half = 2.5 + NAV_CLEARANCE;
  const extension = cellSize * 0.02 + NAV_CLEARANCE;
  for (let y = 0; y < maze.length; y++) for (let x = 0; x < maze[y].length; x++) {
    const cell = maze[y][x];
    const left = x * cellSize, top = y * cellSize;
    for (const side of ["top", "bottom"]) if (cell[side]) {
      walls.push({ x: left - extension, y: top + (side === "bottom" ? cellSize : 0) - half,
        w: cellSize + extension * 2, h: half * 2 });
    }
    for (const side of ["left", "right"]) if (cell[side]) {
      walls.push({ x: left + (side === "right" ? cellSize : 0) - half, y: top - extension,
        w: half * 2, h: cellSize + extension * 2 });
    }
  }
  geometry = { cellSize, walls };
  mazeGeometry.set(maze, geometry);
  return geometry;
}

function wallDistance(from, to, walls) {
  let closest = 1;
  for (const wall of walls) {
    let enter = 0, leave = 1;
    for (const [origin, delta, low, high] of [
      [from.x, to.x - from.x, wall.x, wall.x + wall.w],
      [from.y, to.y - from.y, wall.y, wall.y + wall.h],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < low || origin > high) { enter = 2; break; }
      } else {
        const a = (low - origin) / delta, b = (high - origin) / delta;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter <= leave && leave > 0) closest = Math.min(closest, enter);
  }
  return closest;
}

function cellAt(point, maze, cellSize) {
  const width = maze[0]?.length || 0;
  const height = maze.length;
  if (!width || !height || !cellSize) return null;
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor(point.x / cellSize))),
    y: Math.max(0, Math.min(height - 1, Math.floor(point.y / cellSize))),
  };
}

function nextWaypoint(from, target, maze, cellSize) {
  const start = cellAt(from, maze, cellSize);
  const goal = cellAt(target, maze, cellSize);
  if (!start || !goal) return null;
  const { walls } = geometryFor(maze, cellSize);
  // Aim directly only when the entire segment clears the actual wall shapes.
  if (wallDistance(from, target, walls) >= 1 - 1e-9) return { ...target, corner: false };
  const width = maze[0].length;
  const key = (cell) => cell.y * width + cell.x;
  let route = routes.get(from);
  if (!route || route.maze !== maze || route.cellSize !== cellSize ||
      route.start !== key(start) || route.goal !== key(goal)) {
    route = { maze, cellSize, start: key(start), goal: key(goal), path: [] };
    routes.set(from, route);
    const queue = [start];
    const parents = new Map([[key(start), null]]);
    let destination = null;
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (current.x === goal.x && current.y === goal.y) {
        destination = current;
        break;
      }
      for (const direction of DIRECTIONS) {
        const nx = current.x + direction.dx;
        const ny = current.y + direction.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= maze.length) continue;
        const currentCell = maze[current.y][current.x];
        const nextCell = maze[ny][nx];
        if (currentCell[direction.wall] || nextCell[direction.opposite]) continue;
        const next = { x: nx, y: ny };
        if (parents.has(key(next))) continue;
        parents.set(key(next), current);
        queue.push(next);
      }
    }
    // An unreachable opponent must never produce an aim point through a wall.
    if (!destination) return null;
    const path = [];
    while (destination) {
      path.push(destination);
      destination = parents.get(key(destination));
    }
    route.path = path.reverse().map((cell) => ({
      x: (cell.x + 0.5) * cellSize, y: (cell.y + 0.5) * cellSize,
    }));
  }
  // Pick the first reachable cell center. Choosing a farther visible point can
  // cut diagonally across a closed corner before the missile reaches the bend.
  for (let i = 1; i < route.path.length; i++) {
    if (wallDistance(from, route.path[i], walls) >= 1 - 1e-9) {
      return { ...route.path[i], corner: true };
    }
  }
  // Align inside the current cell first when an off-center entry cannot see
  // the next opening yet. Never fall back to a point behind a closed corner.
  return route.path.length ? { ...route.path[0], corner: true } : null;
}

// Keep guidance separate from wall reflection: a bounce changes the heading,
// and the next step can only slowly bend that new heading toward a tank.
export function steerMisile(bullet, deltaSeconds, tanks = {}, maze = null, cellSize = 70) {
  if (bullet.weapon_type !== "misile") return;
  const age = bullet.age ?? 0;
  bullet.age = age + deltaSeconds;
  const delay = bullet.homing_delay ?? MISILE_HOMING_DELAY;
  const end = delay + (bullet.homing_lifetime ?? MISILE_HOMING_DURATION);
  const homingStep = Math.max(0, Math.min(bullet.age, end) - Math.max(age, delay));
  if (!homingStep) return;

  let nearest = null;
  let nearestDistance = Infinity;
  // Track opponents; the usual collision rules still allow self-hits.
  for (const [name, tank] of Object.entries(tanks)) {
    if (name === bullet.shooter) continue;
    if (!tank || tank.alive === false) continue;
    const distance = Math.hypot(tank.x - bullet.x, tank.y - bullet.y);
    if (distance < nearestDistance) {
      nearest = tank;
      nearestDistance = distance;
    }
  }
  if (!nearest) return;
  // Guidance changes heading only. Missile speed is constant through turns
  // and maze navigation, just as it is through wall reflections.
  const speed = Math.hypot(bullet.vx, bullet.vy) || MISILE_SPEED;
  const heading = Math.atan2(bullet.vy, bullet.vx);
  const navigating = maze?.length && cellSize > 0;
  const waypoint = navigating ? nextWaypoint(bullet, nearest, maze, cellSize) : nearest;
  if (!waypoint) return;
  const desired = Math.atan2(waypoint.y - bullet.y, waypoint.x - bullet.x);
  const error = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
  const maxTurn = (bullet.turn_rate ?? MISILE_TURN_RATE) * homingStep;
  const angle = heading + Math.max(-maxTurn, Math.min(maxTurn, error));
  bullet.vx = Math.cos(angle) * speed;
  bullet.vy = Math.sin(angle) * speed;
}
