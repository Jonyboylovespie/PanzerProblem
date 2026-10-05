const MOVE_SPEED = 135;
const ROTATION_SPEED = 3.6;
const BODY_CLEARANCE = 22;
const WEAPON_SPEEDS = { default: 300, frag: 150, laser: 1500 };
const DIRECTIONS = [
  { x: 1, y: 0, wall: "right", opposite: "left" },
  { x: 0, y: 1, wall: "bottom", opposite: "top" },
  { x: -1, y: 0, wall: "left", opposite: "right" },
  { x: 0, y: -1, wall: "top", opposite: "bottom" },
];

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function hasClearPath(from, to, walls, clearance = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (const wall of walls) {
    let enter = 0;
    let leave = 1;
    for (const [origin, delta, low, high] of [
      [from.x, dx, wall.x - clearance, wall.x + wall.w + clearance],
      [from.y, dy, wall.y - clearance, wall.y + wall.h + clearance],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < low || origin > high) { enter = 2; break; }
      } else {
        const a = (low - origin) / delta;
        const b = (high - origin) / delta;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter <= leave) return false;
  }
  return true;
}

function cellIndex(world, point) {
  const width = world.maze[0].length;
  const x = Math.max(0, Math.min(width - 1, Math.floor(point.x / world.cellSize)));
  const y = Math.max(0, Math.min(world.maze.length - 1, Math.floor(point.y / world.cellSize)));
  return y * width + x;
}

function searchMaze(world, origin) {
  const { maze, cellSize } = world;
  const width = maze[0].length;
  const start = cellIndex(world, origin);
  const parents = new Int32Array(width * maze.length).fill(-1);
  const distances = new Int32Array(parents.length).fill(-1);
  const queue = [start];
  distances[start] = 0;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const x = current % width;
    const y = Math.floor(current / width);
    for (const direction of DIRECTIONS) {
      const nx = x + direction.x;
      const ny = y + direction.y;
      const next = ny * width + nx;
      if (nx < 0 || nx >= width || ny < 0 || ny >= maze.length ||
          maze[y][x][direction.wall] || maze[ny][nx][direction.opposite] ||
          distances[next] !== -1) continue;
      parents[next] = current;
      distances[next] = distances[current] + 1;
      queue.push(next);
    }
  }
  return {
    distances,
    pathTo(point) {
      let current = cellIndex(world, point);
      if (distances[current] < 0) return [];
      const path = [];
      while (current !== -1) {
        path.push({
          x: (current % width + 0.5) * cellSize,
          y: (Math.floor(current / width) + 0.5) * cellSize,
        });
        current = parents[current];
      }
      return path.reverse();
    },
  };
}

export function findMazePath(world, from, to) {
  if (!world.maze.length || !world.cellSize) return [];
  return searchMaze(world, from).pathTo(to);
}

export function predictIntercept(origin, target, velocity, speed, muzzleOffset = 0) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const a = velocity.x ** 2 + velocity.y ** 2 - speed ** 2;
  const b = 2 * (dx * velocity.x + dy * velocity.y - speed * muzzleOffset);
  const c = dx ** 2 + dy ** 2 - muzzleOffset ** 2;
  const discriminant = b ** 2 - 4 * a * c;
  let time = 0;
  if (Math.abs(a) < 1e-9) {
    if (b < 0) time = -c / b;
  } else if (discriminant >= 0) {
    const roots = [(-b - Math.sqrt(discriminant)) / (2 * a),
      (-b + Math.sqrt(discriminant)) / (2 * a)].filter((value) => value > 0);
    if (roots.length) time = Math.min(...roots);
  }
  time = Math.min(time, 1.2);
  return { x: target.x + velocity.x * time, y: target.y + velocity.y * time };
}

// Movement uses the same collision functions as human tanks. Decisions are
// separate from sockets so navigation and combat can be simulated directly.
export function createBotController({ move, rotate, canOccupy, queryWalls }) {
  let maze = null;
  let route = [];
  let goalKey = null;
  let targetName = null;
  let nextThinkAt = 0;
  let nextShotAt = 0;
  let nextPickupAt = 0;
  let blockedFor = 0;
  let recoveryUntil = 0;
  const observations = new Map();

  function clear(world, from, to, padding = 0) {
    const walls = queryWalls ? queryWalls(
      Math.min(from.x, to.x) - padding, Math.min(from.y, to.y) - padding,
      Math.max(from.x, to.x) + padding, Math.max(from.y, to.y) + padding,
    ) : world.wallRects;
    return hasClearPath(from, to, walls, padding);
  }

  function plan(world, tank, opponents, nowMs) {
    const search = searchMaze(world, tank);
    let best = null;
    for (const [otherName, other] of opponents) {
      const previous = observations.get(otherName);
      const elapsed = previous ? (nowMs - previous.time) / 1000 : 0;
      let velocity = { x: 0, y: 0 };
      if (previous && elapsed > 0 && elapsed < 0.8 && distance(previous, other) < 120) {
        velocity = { x: (other.x - previous.x) / elapsed, y: (other.y - previous.y) / elapsed };
        const speed = Math.hypot(velocity.x, velocity.y);
        if (speed > 150) { velocity.x *= 150 / speed; velocity.y *= 150 / speed; }
      }
      observations.set(otherName, { x: other.x, y: other.y, time: nowMs, velocity });
      const steps = search.distances[cellIndex(world, other)];
      if (steps < 0) continue;
      const visible = clear(world, tank, other, 4);
      const score = steps + distance(tank, other) / world.cellSize * 0.25 - (visible ? 3 : 0)
        - (otherName === targetName ? 0.8 : 0);
      if (!best || score < best.score) best = { name: otherName, tank: other, steps, visible, score };
    }
    targetName = best?.name ?? null;
    let goal = best?.tank;
    let key = targetName;
    // Take a nearby weapon along the route when an opponent cannot be shot yet.
    if (best && !best.visible && (tank.weapon || "default") === "default") {
      let closestSteps = Infinity;
      for (const pickup of world.pickups) {
        const steps = search.distances[cellIndex(world, pickup)];
        if (steps >= 0 && steps <= 3 && steps <= best.steps + 1 && steps < closestSteps) {
          goal = pickup;
          key = `pickup:${pickup.id}`;
          closestSteps = steps;
        }
      }
    }
    const newGoalKey = goal ? `${key}:${cellIndex(world, goal)}` : null;
    if (goal && (newGoalKey !== goalKey || !route.length)) {
      route = search.pathTo(goal);
      // Stay on corridor centers at corners; skip a center only if the entire
      // shortcut has room for the tank, including its barrel during turns.
      if (route.length > 1 && clear(world, tank, route[1], BODY_CLEARANCE)) route.shift();
    } else if (!goal) route = [];
    goalKey = newGoalKey;
    nextThinkAt = nowMs + 200;
  }

  function dodge(world, tank) {
    let threat = null;
    for (const bullet of Object.values(world.bullets)) {
      const speedSquared = bullet.vx ** 2 + bullet.vy ** 2;
      if (!speedSquared) continue;
      const dx = tank.x - bullet.x;
      const dy = tank.y - bullet.y;
      const time = (dx * bullet.vx + dy * bullet.vy) / speedSquared;
      if (time < 0 || time > 0.55 || time > bullet.lifetime) continue;
      const closest = { x: bullet.x + bullet.vx * time, y: bullet.y + bullet.vy * time };
      if (distance(tank, closest) > 27 || !clear(world, bullet, closest)) continue;
      if (!threat || time < threat.time) threat = { bullet, time };
    }
    if (!threat) return null;
    const { bullet, time } = threat;
    const perpendicular = Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2;
    let best = null;
    for (const heading of [tank.angle, tank.angle + Math.PI, perpendicular, perpendicular + Math.PI]) {
      const backward = Math.abs(angleDifference(heading, tank.angle)) > Math.PI / 2;
      const bodyAngle = backward ? heading + Math.PI : heading;
      const turnTime = Math.abs(angleDifference(bodyAngle, tank.angle)) / ROTATION_SPEED;
      const drive = backward ? -0.65 : 1;
      const travel = MOVE_SPEED * Math.abs(drive) * Math.max(0, Math.max(time, 0.25) - turnTime);
      const end = { x: tank.x + Math.cos(heading) * travel, y: tank.y + Math.sin(heading) * travel };
      if (travel < 5 || !canOccupy({ ...tank, angle: bodyAngle }) ||
          !clear(world, tank, end, BODY_CLEARANCE)) continue;
      const miss = Math.abs((end.x - bullet.x) * bullet.vy - (end.y - bullet.y) * bullet.vx)
        / Math.hypot(bullet.vx, bullet.vy);
      const score = miss - turnTime * 12;
      if (!best || score > best.score) best = { angle: bodyAngle, drive, score };
    }
    return best?.score > 5 ? best : null;
  }

  return {
    update(world, name, nowMs, deltaSeconds) {
      deltaSeconds = Math.max(0, Math.min(deltaSeconds, 0.05));
      const tank = world.tanks[name];
      const result = { changed: false, shoot: false, pickupId: null };
      if (!tank || tank.alive === false || !world.maze.length || !world.cellSize) return result;
      if (maze !== world.maze) {
        maze = world.maze;
        route = [];
        goalKey = targetName = null;
        nextThinkAt = recoveryUntil = blockedFor = 0;
        // Observe motion once before firing, so the opening shot can lead a
        // moving opponent instead of immediately wasting the only projectile.
        nextShotAt = nowMs + 200;
        nextPickupAt = 0;
        observations.clear();
      }
      const step = MOVE_SPEED * Math.min(deltaSeconds, 0.05);
      if (nowMs < recoveryUntil) {
        result.changed = move(tank, -Math.cos(tank.angle) * step * 0.65, -Math.sin(tank.angle) * step * 0.65);
        if (!result.changed) result.changed = move(tank, Math.cos(tank.angle) * step * 0.35, Math.sin(tank.angle) * step * 0.35);
        return result;
      }
      const opponents = Object.entries(world.tanks).filter(([otherName, other]) =>
        otherName !== name && other && other.alive !== false);
      if (nowMs >= nextThinkAt || (targetName &&
          (!world.tanks[targetName] || world.tanks[targetName].alive === false))) {
        plan(world, tank, opponents, nowMs);
      }
      const target = world.tanks[targetName];
      const visible = target && clear(world, tank, target, 4);
      let aim = target;
      if (visible) {
        const velocity = observations.get(targetName)?.velocity || { x: 0, y: 0 };
        const prediction = predictIntercept(tank, target, velocity, WEAPON_SPEEDS[tank.weapon] || 300, 25);
        if (clear(world, target, prediction, 15) && clear(world, tank, prediction, 4)) aim = prediction;
      }
      while (route.length && distance(tank, route[0]) < 5) route.shift();
      let desiredAngle = tank.angle;
      let drive = 0;
      let travel = step;
      const evasion = dodge(world, tank);
      if (evasion) {
        desiredAngle = evasion.angle;
        drive = evasion.drive;
        goalKey = null;
      } else if (visible) {
        desiredAngle = Math.atan2(aim.y - tank.y, aim.x - tank.x);
        if (distance(tank, target) < 85) drive = -0.65;
        else if (distance(tank, target) > 190 && clear(world, tank, target, BODY_CLEARANCE)) drive = 1;
      } else if (route.length) {
        const waypoint = route[0];
        desiredAngle = Math.atan2(waypoint.y - tank.y, waypoint.x - tank.x);
        drive = 1;
        if (Math.abs(angleDifference(desiredAngle, tank.angle)) > 2.3) {
          desiredAngle += Math.PI;
          drive = -0.65;
        }
        travel = Math.min(step, distance(tank, waypoint) / Math.abs(drive));
      }
      const error = angleDifference(desiredAngle, tank.angle);
      let blocked = false;
      if (Math.abs(error) > 0.005) {
        const turn = Math.sign(error) * Math.min(Math.abs(error), ROTATION_SPEED * deltaSeconds);
        const rotated = rotate(tank, turn);
        result.changed ||= rotated;
        blocked = !rotated;
      }
      // Rotate before driving, rather than cutting diagonally across corners.
      if (drive && Math.abs(angleDifference(desiredAngle, tank.angle)) < 0.08) {
        const moved = move(tank, Math.cos(tank.angle) * travel * drive, Math.sin(tank.angle) * travel * drive);
        result.changed ||= moved;
        blocked ||= !moved;
      }
      blockedFor = blocked ? blockedFor + deltaSeconds : 0;
      if (blockedFor > 0.28) {
        recoveryUntil = nowMs + 250;
        goalKey = null;
        route = [];
        nextThinkAt = blockedFor = 0;
      }
      const activeFrag = Object.values(world.bullets).find((bullet) =>
        bullet.shooter === name && bullet.weapon_type === "frag");
      if (nowMs >= nextShotAt) {
        if (activeFrag && distance(tank, activeFrag) > 110 && opponents.some(([, other]) =>
          distance(other, activeFrag) < 100 && clear(world, activeFrag, other, 2))) {
          result.shoot = true;
        } else if (!activeFrag && visible && !evasion && distance(tank, target) > 40) {
          const muzzle = { x: tank.x + Math.cos(tank.angle) * 25, y: tank.y + Math.sin(tank.angle) * 25 };
          const tolerance = Math.min(0.10, Math.atan2(10, distance(tank, aim)));
          const active = Object.values(world.bullets).some((bullet) =>
            bullet.shooter === name && (bullet.weapon_type || "default") === (tank.weapon || "default"));
          if (!active && Math.abs(angleDifference(desiredAngle, tank.angle)) < tolerance &&
              clear(world, tank, muzzle, 4) && clear(world, muzzle, aim, 4)) result.shoot = true;
        }
        if (result.shoot) nextShotAt = nowMs + 420;
      }
      if (nowMs >= nextPickupAt && (tank.weapon || "default") === "default") {
        result.pickupId = world.pickups.find((pickup) => distance(tank, pickup) < 20)?.id ?? null;
        if (result.pickupId) nextPickupAt = nowMs + 350;
      }
      return result;
    },
  };
}
