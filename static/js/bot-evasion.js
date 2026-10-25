import { stepBullet } from "./bullet-physics.js";

const HORIZON = 0.8;
const STEP = 1 / 30;
const HIT_RADIUS = 15;
const SAFETY_MARGIN = 32;
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function sweptDistance(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const t = Math.max(0, Math.min(1, -(from.x * dx + from.y * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(from.x + dx * t, from.y + dy * t);
}

export function createBulletAvoidance({ canOccupy, queryWalls, moveSpeed, turnSpeed, predictDriveSpeed }) {
  let nextCheckAt = 0;
  let bulletKey = "";
  let escape = null;

  function trajectories(world, tank) {
    const paths = [];
    for (const original of Object.values(world.bullets)) {
      const speed = Math.hypot(original.vx, original.vy);
      const lifetime = Math.min(HORIZON, original.lifetime ?? HORIZON);
      if (!speed || lifetime <= 0 || distance(tank, original) > (speed + moveSpeed) * lifetime + SAFETY_MARGIN) continue;
      // Include the bot's own shots: ricochets can kill their shooter too.
      const bullet = { ...original };
      const slices = [];
      let relevant = false;
      for (let time = 0; time < lifetime - 1e-9; time += STEP) {
        const dt = Math.min(STEP, lifetime - time);
        const points = [{ x: bullet.x, y: bullet.y }];
        const next = stepBullet(bullet, dt, world.wallRects, queryWalls, points, world.tanks,
          world.maze, world.cellSize);
        // Each bounce is a separate segment, including fast laser ricochets.
        if (points.length === 1) points.push({ x: next.nextX, y: next.nextY });
        const lengths = points.slice(1).map((point, index) => distance(point, points[index]));
        const length = lengths.reduce((sum, value) => sum + value, 0);
        let elapsed = 0;
        const segments = [];
        for (let i = 1; i < points.length; i++) {
          const duration = length ? dt * lengths[i - 1] / length : dt;
          segments.push({ from: points[i - 1], to: points[i], start: elapsed / STEP, end: (elapsed + duration) / STEP });
          elapsed += duration;
          const from = { x: points[i - 1].x - tank.x, y: points[i - 1].y - tank.y };
          const to = { x: points[i].x - tank.x, y: points[i].y - tank.y };
          if (sweptDistance(from, to) < moveSpeed * (time + dt) + SAFETY_MARGIN) relevant = true;
        }
        slices.push(segments);
        bullet.x = next.nextX; bullet.y = next.nextY;
        if (next.hitWall) break;
      }
      if (relevant) paths.push({ slices, angle: Math.atan2(original.vy, original.vx) });
    }
    return paths;
  }

  function evaluate(tank, action, currentSpeed, paths) {
    const ghost = { ...tank };
    let speed = currentSpeed;
    let remaining = action.distanceLimit ?? Infinity;
    let clearance = Infinity;
    let risk = 0;
    let collisions = 0;
    let travel = 0;
    for (let i = 0; i < Math.ceil(HORIZON / STEP); i++) {
      const from = { x: ghost.x, y: ghost.y };
      const error = angleDifference(action.angle, ghost.angle);
      const turned = { ...ghost, angle: ghost.angle + Math.sign(error) * Math.min(Math.abs(error), turnSpeed * STEP) };
      if (canOccupy(turned)) ghost.angle = turned.angle;
      const alignment = Math.max(0, Math.cos(angleDifference(action.angle, ghost.angle)));
      speed = predictDriveSpeed(ghost, action.angle, moveSpeed * action.drive * alignment ** 2, STEP, remaining, speed);
      const amount = Math.sign(speed) * Math.min(Math.abs(speed) * STEP, remaining);
      const moved = { ...ghost, x: ghost.x + Math.cos(ghost.angle) * amount, y: ghost.y + Math.sin(ghost.angle) * amount };
      if (canOccupy(moved)) {
        ghost.x = moved.x; ghost.y = moved.y;
        remaining -= Math.abs(amount); travel += Math.abs(amount);
      } else speed = 0;
      for (const path of paths) {
        for (const segment of path.slices[i] || []) {
          const dx = ghost.x - from.x, dy = ghost.y - from.y;
          const relativeFrom = { x: segment.from.x - from.x - dx * segment.start,
            y: segment.from.y - from.y - dy * segment.start };
          const relativeTo = { x: segment.to.x - from.x - dx * segment.end,
            y: segment.to.y - from.y - dy * segment.end };
          // A safely separating shot needs no reaction. This also keeps the
          // bot from fleeing every outgoing shot as it leaves its muzzle.
          const separating = relativeFrom.x * (relativeTo.x - relativeFrom.x)
            + relativeFrom.y * (relativeTo.y - relativeFrom.y) >= 0;
          if (separating && Math.hypot(relativeFrom.x, relativeFrom.y) > HIT_RADIUS + 2) continue;
          const gap = sweptDistance(relativeFrom, relativeTo);
          clearance = Math.min(clearance, gap);
          const urgency = 1.5 - i * STEP;
          risk += Math.max(0, SAFETY_MARGIN - gap) * urgency;
          if (gap < HIT_RADIUS + 2) collisions += urgency;
        }
      }
    }
    return { clearance, score: Math.min(65, clearance) - risk * 3 - collisions * 1000 + travel * 0.02 };
  }

  return {
    reset() { nextCheckAt = 0; bulletKey = ""; escape = null; },
    update(world, tank, normal, currentSpeed, nowMs) {
      const key = Object.keys(world.bullets).join("\0");
      // New or removed projectiles bypass the throttle immediately.
      if (key === bulletKey && nowMs < nextCheckAt) return escape;
      bulletKey = key;
      nextCheckAt = nowMs + 80;
      const paths = trajectories(world, tank);
      if (!paths.length) { escape = null; return null; }
      const baseline = evaluate(tank, normal, currentSpeed, paths);
      if (baseline.clearance >= SAFETY_MARGIN) { escape = null; return null; }
      let best = { ...normal, ...baseline };
      const actions = [{ angle: tank.angle, drive: 0 }, { angle: tank.angle, drive: 1 },
        { angle: tank.angle, drive: -0.65 }];
      if (escape) actions.push(escape);
      const headings = Array.from({ length: 8 }, (_, i) => tank.angle + i * Math.PI / 4);
      for (const path of paths.slice(0, 3)) headings.push(path.angle + Math.PI / 2, path.angle - Math.PI / 2);
      for (const heading of headings) {
        const backwards = Math.abs(angleDifference(heading, tank.angle)) > Math.PI / 2;
        actions.push({ angle: backwards ? heading + Math.PI : heading, drive: backwards ? -0.65 : 1 });
      }
      for (const action of actions) {
        const value = evaluate(tank, action, currentSpeed, paths);
        // Small preference for continuing an escape avoids steering jitter.
        if (escape && action.drive === escape.drive && Math.abs(angleDifference(action.angle, escape.angle)) < 0.1) value.score += 2;
        if (value.score > best.score + 0.5) best = { ...action, ...value };
      }
      escape = best.score > baseline.score + 1 ? { angle: best.angle, drive: best.drive } : null;
      return escape;
    },
  };
}
