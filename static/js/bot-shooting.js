import { bulletSpawnPosition, stepBullet } from "./bullet-physics.js";
import { MISILE_SPEED } from "./misile.js";

const SPEEDS = { default: 300, frag: 150, laser: 2700, misile: MISILE_SPEED };
// Bank-shot planning covers only the initial straight flight, before homing.
const MAX_FLIGHT = { default: 2, frag: 3, laser: 0.75, misile: 2 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function closestFraction(point, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1)));
}

function mirror(point, surface) {
  return { ...point, [surface.axis]: 2 * surface.face - point[surface.axis] };
}

function wallSurfaces(walls) {
  const groups = new Map();
  for (const wall of walls) {
    const horizontal = wall.w > wall.h;
    const axis = horizontal ? "y" : "x";
    const along = horizontal ? "x" : "y";
    for (const face of [wall[axis], wall[axis] + (horizontal ? wall.h : wall.w)]) {
      const key = `${axis}:${face}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ axis, along, face, low: wall[along], high: wall[along] + (horizontal ? wall.w : wall.h) });
    }
  }
  const surfaces = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.low - b.low);
    let current = null;
    for (const surface of group) {
      if (current && surface.low <= current.high) current.high = Math.max(current.high, surface.high);
      else { current = { ...surface }; surfaces.push(current); }
    }
  }
  return surfaces;
}

function targetPrediction(target, velocity, duration, canOccupy) {
  const points = [{ ...target }];
  for (let i = 1; i <= Math.ceil(duration * 60) + 1; i++) {
    const previous = points[i - 1];
    const next = { ...previous, x: previous.x + velocity.x / 60, y: previous.y + velocity.y / 60 };
    points.push(canOccupy(next) ? next : previous);
  }
  return (time) => {
    const index = Math.max(0, Math.min(points.length - 2, Math.floor(time * 60)));
    const fraction = Math.max(0, Math.min(1, time * 60 - index));
    return { x: points[index].x + (points[index + 1].x - points[index].x) * fraction,
      y: points[index].y + (points[index + 1].y - points[index].y) * fraction };
  };
}

// Validate from the actual muzzle with the same ricochet physics as live shots.
// Use swept relative motion so neither a laser nor a moving target is skipped.
export function evaluateRicochet(world, tank, targetAt, angle, queryWalls, duration = MAX_FLIGHT[tank.weapon || "default"]) {
  const weapon = tank.weapon || "default";
  const speed = SPEEDS[weapon];
  if (!speed || !duration) return null;
  const bullet = { ...bulletSpawnPosition({ ...tank, angle }, world.wallRects, queryWalls),
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, weapon_type: weapon };
  if (distance(bullet, tank) < 19) return null;
  const dt = Math.min(1 / 60, 5 / speed);
  let bounces = 0;
  for (let time = 0; time < duration; time += dt) {
    const from = { x: bullet.x, y: bullet.y };
    const vx = bullet.vx, vy = bullet.vy;
    const next = stepBullet(bullet, dt, world.wallRects, queryWalls);
    const to = { x: next.nextX, y: next.nextY };
    if (next.hitWall) return null;
    if (bullet.vx !== vx || bullet.vy !== vy) bounces++;
    const selfFraction = closestFraction(tank, from, to);
    if (distance(tank, { x: from.x + (to.x - from.x) * selfFraction,
      y: from.y + (to.y - from.y) * selfFraction }) < 19) return null;
    const startTarget = targetAt(time), endTarget = targetAt(time + dt);
    const relativeFrom = { x: from.x - startTarget.x, y: from.y - startTarget.y };
    const relativeTo = { x: to.x - endTarget.x, y: to.y - endTarget.y };
    const fraction = closestFraction({ x: 0, y: 0 }, relativeFrom, relativeTo);
    const miss = Math.hypot(relativeFrom.x + (relativeTo.x - relativeFrom.x) * fraction,
      relativeFrom.y + (relativeTo.y - relativeFrom.y) * fraction);
    if (miss < 12) return bounces ? { time: time + dt * fraction, bounces } : null;
    bullet.x = to.x; bullet.y = to.y;
  }
  return null;
}

export function createRicochetPlanner({ canOccupy, queryWalls, clearPath }) {
  let maze = null;
  let walls = null;
  let surfaces = [];
  let nextCheckAt = 0;
  let previous = null;
  let shot = null;

  function geometry(world, origin, destination, sequence) {
    let end = destination;
    for (let i = sequence.length - 1; i >= 0; i--) end = mirror(end, sequence[i]);
    const points = [origin];
    let from = origin;
    for (const surface of sequence) {
      const delta = end[surface.axis] - from[surface.axis];
      const fraction = (surface.face - from[surface.axis]) / delta;
      if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return null;
      const bounce = { x: from.x + (end.x - from.x) * fraction, y: from.y + (end.y - from.y) * fraction };
      if (bounce[surface.along] < surface.low + 4 || bounce[surface.along] > surface.high - 4) return null;
      points.push(bounce);
      from = bounce;
      end = mirror(end, surface);
    }
    points.push(destination);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const segment = distance(a, b);
      if (segment < 6) return null;
      const trim = i > 1 ? 2 / segment : 0;
      const endTrim = i < points.length - 1 ? 2 / segment : 0;
      const from = { x: a.x + (b.x - a.x) * trim, y: a.y + (b.y - a.y) * trim };
      const to = { x: b.x - (b.x - a.x) * endTrim, y: b.y - (b.y - a.y) * endTrim };
      if (!clearPath(world, from, to, 0.5)) return null;
      length += segment;
    }
    return { angle: Math.atan2(points[1].y - origin.y, points[1].x - origin.x), length };
  }

  return {
    reset() { maze = walls = previous = shot = null; nextCheckAt = 0; },
    update(world, tank, target, targetName, velocity, nowMs) {
      if (maze !== world.maze || walls !== world.wallRects) {
        maze = world.maze; walls = world.wallRects;
        surfaces = wallSurfaces(walls); previous = shot = null; nextCheckAt = 0;
      }
      const weapon = tank.weapon || "default";
      if (!target || target.alive === false || !SPEEDS[weapon]) { shot = null; return null; }
      if (previous && previous.name === targetName && previous.weapon === weapon &&
          distance(previous.origin, tank) < 7 && distance(previous.target, target) < 12 &&
          distance(previous.velocity, velocity) < 15 && nowMs < nextCheckAt) return shot;
      previous = { name: targetName, weapon, origin: { ...tank }, target: { ...target }, velocity: { ...velocity } };
      nextCheckAt = nowMs + 250;
      shot = null;
      const speed = SPEEDS[weapon], duration = MAX_FLIGHT[weapon];
      const targetAt = targetPrediction(target, velocity, duration, canOccupy);
      const nearby = surfaces.map((surface) => {
        const point = { [surface.axis]: surface.face,
          [surface.along]: Math.max(surface.low, Math.min(surface.high, tank[surface.along])) };
        return { surface, range: distance(tank, point) };
      }).filter(({ range }) => range < speed * duration * 0.65)
        .sort((a, b) => a.range - b.range).slice(0, 32).map(({ surface }) => surface);
      function candidate(sequence) {
        let destination = target;
        let value = null;
        for (let i = 0; i < 3; i++) {
          value = geometry(world, tank, destination, sequence);
          if (!value) return null;
          const time = Math.max(0, (value.length - 25) / speed);
          if (time > duration) return null;
          destination = targetAt(time);
        }
        if (!canOccupy({ ...tank, angle: value.angle })) return null;
        return { ...value, score: (value.length - 25) / speed
          + Math.abs(angleDifference(value.angle, tank.angle)) * 0.15 + sequence.length * 0.1 };
      }
      function choose(candidates) {
        candidates.sort((a, b) => a.score - b.score);
        for (const value of candidates.slice(0, 8)) {
          const hit = evaluateRicochet(world, tank, targetAt, value.angle, queryWalls, duration);
          if (hit) return { ...value, ...hit };
        }
        return null;
      }
      const singles = nearby.map((surface) => candidate([surface])).filter(Boolean);
      shot = choose(singles);
      if (!shot) {
        const doubles = [];
        for (const first of nearby) for (const second of nearby) {
          if (first === second || (first.axis === second.axis && first.face === second.face)) continue;
          const value = candidate([first, second]);
          if (value) doubles.push(value);
        }
        shot = choose(doubles);
      }
      return shot;
    },
    canFire(world, tank, target, velocity) {
      if (!target || target.alive === false) return false;
      return !!evaluateRicochet(world, tank,
        targetPrediction(target, velocity, MAX_FLIGHT[tank.weapon || "default"], canOccupy), tank.angle, queryWalls);
    },
  };
}
