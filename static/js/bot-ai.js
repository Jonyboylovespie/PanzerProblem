import { createBulletAvoidance } from "./bot-evasion.js";
import { MISILE_SPEED } from "./misile.js";
import { createRicochetPlanner } from "./bot-shooting.js";
import { blastExposed, canLaunchFrag, choosePickup, findFragCover, retreatFrom, shouldDetonateFrag } from "./bot-items.js";

const MOVE_SPEED = 135;
const ROTATION_SPEED = 3.6;
const BODY_CLEARANCE = 22;
const WEAPON_SPEEDS = { default: 300, frag: 150, laser: 2700, misile: MISILE_SPEED };
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

export function predictIntercept(origin, target, velocity, speed, muzzleOffset = 0, maxTime = 1.2) {
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
  time = Math.min(time, maxTime);
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
  let driveSpeed = 0;
  let maneuver = null;
  let nextManeuverAt = 0;
  let maneuverSign = 1;
  let pickupGoal = null;
  let coverGoal = null;
  let lastWeapon = null;
  let lastFragId = null;
  let lastDangerId = null;
  let nextDetonateAt = 0;
  const observations = new Map();
  const ricochets = createRicochetPlanner({ canOccupy, queryWalls, clearPath: clear });
  const avoidance = createBulletAvoidance({
    canOccupy, queryWalls, moveSpeed: MOVE_SPEED, turnSpeed: ROTATION_SPEED,
    predictDriveSpeed: safeDriveSpeed,
  });

  function clear(world, from, to, padding = 0) {
    const walls = queryWalls ? queryWalls(
      Math.min(from.x, to.x) - padding, Math.min(from.y, to.y) - padding,
      Math.max(from.x, to.x) + padding, Math.max(from.y, to.y) + padding,
    ) : world.wallRects;
    return hasClearPath(from, to, walls, padding);
  }

  function plan(world, tank, opponents, nowMs, name, fragDanger) {
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
    pickupGoal = choosePickup({ world, tank, name, opponents, target: best?.tank,
      search, cellIndex, searchMaze, clear, previousId: pickupGoal?.id });
    coverGoal = fragDanger ? findFragCover(world, tank, fragDanger, search, clear) : null;
    if (pickupGoal) { goal = pickupGoal; key = `pickup:${pickupGoal.id}`; }
    if (coverGoal) { goal = coverGoal; key = "frag-cover"; pickupGoal = null; }
    const newGoalKey = goal ? `${key}:${cellIndex(world, goal)}` : null;
    if (goal && (newGoalKey !== goalKey || !route.length)) {
      route = search.pathTo(goal);
      if (pickupGoal && distance(route.at(-1), pickupGoal) > 1) route.push({ x: pickupGoal.x, y: pickupGoal.y });
      // Stay on corridor centers at corners; skip a center only if the entire
      // shortcut has room for the tank, including its barrel during turns.
      if (route.length > 1 && clear(world, tank, route[1], BODY_CLEARANCE)) route.shift();
    } else if (!goal) route = [];
    goalKey = newGoalKey;
    nextThinkAt = nowMs + 200;
  }

  function reposition(world, tank, target, aimAngle, nowMs) {
    if (nowMs < nextManeuverAt) return maneuver;
    nextManeuverAt = nowMs + 650;
    maneuver = null;
    // The turret follows the body. Use the wait between shots to change
    // position, then return to the original intercept aim when ready to fire.
    const range = distance(tank, target);
    for (const side of [maneuverSign, -maneuverSign]) {
      const angle = aimAngle + side * 1.15;
      const drive = range < 125 ? -0.65 : 1;
      const end = { x: tank.x + Math.cos(angle) * 50 * drive,
        y: tank.y + Math.sin(angle) * 50 * drive };
      if (!clear(world, tank, end, BODY_CLEARANCE) || !canOccupy({ ...end, angle })) continue;
      maneuverSign = side;
      maneuver = { angle, drive };
      break;
    }
    // In a narrow corridor, advance or retreat without turning into its walls.
    if (!maneuver) {
      const drive = range < 145 ? -0.65 : 1;
      const end = { x: tank.x + Math.cos(aimAngle) * 40 * drive,
        y: tank.y + Math.sin(aimAngle) * 40 * drive };
      if (clear(world, tank, end, BODY_CLEARANCE)) maneuver = { angle: aimAngle, drive };
    }
    return maneuver;
  }

  function safeDriveSpeed(tank, desiredAngle, requestedSpeed, deltaSeconds, distanceLimit, currentSpeed = driveSpeed) {
    // Test the curved path, not only the endpoint. Brake ahead of tight corners
    // so there is still room to turn instead of wedging the barrel into a wall.
    const horizon = 0.22;
    const slice = horizon / 8;
    const acceleration = 900 * deltaSeconds;
    const speed = currentSpeed + Math.max(-acceleration, Math.min(acceleration, requestedSpeed - currentSpeed));
    for (const multiplier of [1, 0.5, 0.25]) {
      const ghost = { ...tank };
      let remaining = distanceLimit;
      let safe = true;
      for (let i = 0; i < 8; i++) {
        const error = angleDifference(desiredAngle, ghost.angle);
        ghost.angle += Math.sign(error) * Math.min(Math.abs(error), ROTATION_SPEED * slice);
        const travel = Math.sign(speed) * Math.min(Math.abs(speed) * multiplier * slice, remaining);
        remaining -= Math.abs(travel);
        ghost.x += Math.cos(ghost.angle) * travel;
        ghost.y += Math.sin(ghost.angle) * travel;
        if (!canOccupy(ghost)) { safe = false; break; }
      }
      if (safe) return speed * multiplier;
    }
    return 0;
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
        pickupGoal = coverGoal = null;
        lastWeapon = lastFragId = lastDangerId = null;
        nextDetonateAt = 0;
        driveSpeed = 0;
        maneuver = null;
        nextManeuverAt = 0;
        maneuverSign = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 2 ? 1 : -1;
        observations.clear();
        avoidance.reset();
        ricochets.reset();
      }
      const step = MOVE_SPEED * Math.min(deltaSeconds, 0.05);
      const opponents = Object.entries(world.tanks).filter(([otherName, other]) =>
        otherName !== name && other && other.alive !== false);
      const weapon = tank.weapon || "default";
      const ownFrags = Object.entries(world.bullets).find(([, bullet]) => bullet.shooter === name && bullet.weapon_type === "frag");
      const activeFrag = ownFrags?.[1];
      const fragId = ownFrags?.[0] ?? null;
      const enemyFragEntry = Object.entries(world.bullets).filter(([, bullet]) => bullet.shooter !== name &&
        bullet.weapon_type === "frag" && distance(tank, bullet) < 170 && blastExposed(world, bullet, tank, clear))
        .sort((a, b) => distance(tank, a[1]) - distance(tank, b[1]))[0];
      const enemyFrag = enemyFragEntry?.[1];
      const fragDanger = enemyFrag || activeFrag;
      const dangerId = enemyFragEntry?.[0] ?? fragId;
      if (dangerId !== lastDangerId) { nextThinkAt = 0; lastDangerId = dangerId; }
      if (fragId !== lastFragId) { nextDetonateAt = 0; nextThinkAt = 0; lastFragId = fragId; }
      if (nowMs >= nextThinkAt || weapon !== lastWeapon || (pickupGoal && !world.pickups.some((pickup) => pickup.id === pickupGoal.id)) || (targetName &&
          (!world.tanks[targetName] || world.tanks[targetName].alive === false))) {
        plan(world, tank, opponents, nowMs, name, fragDanger);
        lastWeapon = weapon;
      }
      const target = world.tanks[targetName];
      const visible = target && clear(world, tank, target, 4);
      const velocity = observations.get(targetName)?.velocity || { x: 0, y: 0 };
      let aim = target;
      if (visible) {
        const prediction = predictIntercept(tank, target, velocity, WEAPON_SPEEDS[weapon] || 300, 25, weapon === "frag" ? 3 : 1.2);
        if (clear(world, target, prediction, 15) && clear(world, tank, prediction, 4)) aim = prediction;
      }
      while (route.length && distance(tank, route[0]) < 5) route.shift();
      // Look through successive waypoints only when the entire shortcut fits
      // the tank. Open stretches no longer require a stop at every cell center.
      while (route.length > 1 && clear(world, tank, route[1], BODY_CLEARANCE)) route.shift();
      let desiredAngle = tank.angle;
      const aimAngle = visible ? Math.atan2(aim.y - tank.y, aim.x - tank.x) : null;
      let drive = 0;
      let travel = step;
      let distanceLimit = Infinity;
      const activeShot = Object.values(world.bullets).some((bullet) =>
        bullet.shooter === name && (bullet.weapon_type || "default") === (tank.weapon || "default"));
      const bankShot = !visible && !activeShot && !pickupGoal && !fragDanger && nowMs >= recoveryUntil
        ? ricochets.update(world, tank, target, targetName, velocity, nowMs) : null;
      if (nowMs < recoveryUntil) {
        drive = -0.65;
        const behind = { ...tank, x: tank.x - Math.cos(tank.angle) * step * 0.65,
          y: tank.y - Math.sin(tank.angle) * step * 0.65 };
        if (!canOccupy(behind)) drive = 0.35;
      } else if (fragDanger && !blastExposed(world, fragDanger, tank, clear)) {
        // Stay behind cover while controlling a grenade; do not walk back out
        // into the fragments just to keep aiming at an opponent.
        drive = 0;
      } else if ((coverGoal || pickupGoal) && route.length) {
        const waypoint = route[0];
        desiredAngle = Math.atan2(waypoint.y - tank.y, waypoint.x - tank.x);
        drive = 1;
        if (Math.abs(angleDifference(desiredAngle, tank.angle)) > 2.3) { desiredAngle += Math.PI; drive = -0.65; }
        distanceLimit = distance(tank, waypoint);
        travel = Math.min(step, distanceLimit / Math.abs(drive));
      } else if (fragDanger) {
        const retreat = retreatFrom(world, tank, fragDanger, clear, canOccupy);
        if (retreat) { desiredAngle = retreat.angle; drive = retreat.drive; }
      } else if (bankShot) {
        // Settle briefly to aim the bank, then continue moving once it is in
        // flight. A threatened tank will still override this with an escape.
        desiredAngle = bankShot.angle;
      } else if (visible) {
        desiredAngle = aimAngle;
        const range = distance(tank, target);
        const minimum = weapon === "frag" ? 170 : weapon === "laser" ? 120 : 85;
        const maximum = weapon === "frag" ? 300 : weapon === "laser" ? 360 : weapon === "misile" ? 420 : 190;
        if (range < minimum) {
          const retreat = weapon === "frag" ? retreatFrom(world, tank, target, clear, canOccupy) : null;
          if (retreat) { desiredAngle = retreat.angle; drive = retreat.drive; }
          else drive = -0.65;
        } else if (range > maximum && clear(world, tank, target, BODY_CLEARANCE)) drive = 1;
        if (activeShot && distance(tank, target) >= 85 && distance(tank, target) <= 250) {
          const movement = reposition(world, tank, target, aimAngle, nowMs);
          if (movement) { desiredAngle = movement.angle; drive = movement.drive; }
        } else { maneuver = null; nextManeuverAt = 0; }
      } else if (route.length) {
        const waypoint = route[0];
        desiredAngle = Math.atan2(waypoint.y - tank.y, waypoint.x - tank.x);
        drive = 1;
        if (Math.abs(angleDifference(desiredAngle, tank.angle)) > 2.3) {
          desiredAngle += Math.PI;
          drive = -0.65;
        }
        travel = Math.min(step, distance(tank, waypoint) / Math.abs(drive));
        distanceLimit = distance(tank, waypoint);
      }
      const evasion = avoidance.update(world, tank,
        { angle: desiredAngle, drive, distanceLimit }, driveSpeed, nowMs);
      if (evasion) {
        desiredAngle = evasion.angle;
        drive = evasion.drive;
        distanceLimit = Infinity;
        travel = step;
        goalKey = null;
        recoveryUntil = 0;
        maneuver = null;
        nextManeuverAt = 0;
      }
      const error = angleDifference(desiredAngle, tank.angle);
      let blocked = false;
      if (Math.abs(error) > 0.005) {
        const turn = Math.sign(error) * Math.min(Math.abs(error), ROTATION_SPEED * deltaSeconds);
        const rotated = rotate(tank, turn);
        result.changed ||= rotated;
        blocked = !rotated;
      }
      // Steer and drive together with gradual acceleration. Slow down for a
      // large heading change and let collision forecasts enforce corner space.
      const alignment = Math.max(0, Math.cos(angleDifference(desiredAngle, tank.angle)));
      driveSpeed = safeDriveSpeed(tank, desiredAngle, MOVE_SPEED * drive * alignment ** 2, deltaSeconds, distanceLimit);
      const movement = Math.sign(driveSpeed) * Math.min(Math.abs(driveSpeed) * deltaSeconds,
        drive ? travel * Math.abs(drive) : step);
      if (Math.abs(movement) > 0.001) {
        const moved = move(tank, Math.cos(tank.angle) * movement, Math.sin(tank.angle) * movement);
        result.changed ||= moved;
        blocked ||= !moved;
        if (!moved) driveSpeed = 0;
      }
      // A forecast can stop the tank before an actual collision. Treat a
      // sustained aligned stop as blocked too, so it still gets unstuck.
      blocked ||= !!drive && Math.abs(driveSpeed) < 1 && Math.abs(error) < 0.08;
      blockedFor = blocked ? blockedFor + deltaSeconds : 0;
      if (blockedFor > 0.28) {
        recoveryUntil = nowMs + 250;
        goalKey = null;
        route = [];
        nextThinkAt = blockedFor = 0;
      }
      // Remote detonation is independent of the launch cooldown and body aim.
      if (activeFrag && weapon === "frag" && nowMs >= nextDetonateAt && shouldDetonateFrag(world, tank, activeFrag,
          opponents, observations, clear, canOccupy)) {
        result.shoot = true;
        nextDetonateAt = nowMs + 250;
        nextShotAt = nowMs + 420;
      }
      if (nowMs >= nextShotAt && nowMs >= recoveryUntil) {
        if (!activeFrag && (visible || bankShot) && !evasion && distance(tank, target) > 40) {
          const muzzle = { x: tank.x + Math.cos(tank.angle) * 25, y: tank.y + Math.sin(tank.angle) * 25 };
          const shotAngle = visible ? aimAngle : bankShot.angle;
          const shotDistance = visible ? distance(tank, aim) : bankShot.length;
          const tolerance = Math.min(0.10, Math.atan2(10, shotDistance));
          if (!activeShot && Math.abs(angleDifference(shotAngle, tank.angle)) < tolerance) {
            result.shoot = visible ? clear(world, tank, muzzle, 4) && clear(world, muzzle, aim, 4)
              : ricochets.canFire(world, tank, target, velocity);
            if (result.shoot && weapon === "frag" && !canLaunchFrag(world, tank, target, velocity, clear, canOccupy, queryWalls)) {
              result.shoot = false;
              nextShotAt = nowMs + 200;
            }
          }
        }
        if (result.shoot) nextShotAt = nowMs + 420;
      }
      if (nowMs >= nextPickupAt && weapon === "default" && !activeFrag) {
        const nearby = world.pickups.filter((pickup) => ["laser", "frag", "misile"].includes(pickup.type) &&
          distance(tank, pickup) < 20 && clear(world, tank, pickup));
        result.pickupId = nearby.find((pickup) => pickup.id === pickupGoal?.id)?.id
          ?? nearby.sort((a, b) => (a.type === "laser" ? -1 : 1) - (b.type === "laser" ? -1 : 1))[0]?.id ?? null;
        if (result.pickupId) nextPickupAt = nowMs + 350;
      }
      return result;
    },
  };
}
