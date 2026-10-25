import { bulletSpawnPosition, stepBullet } from "./bullet-physics.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const KNOWN_ITEMS = new Set(["laser", "frag", "misile"]);
// Fragments travel at 300px/s for 1.5s and disappear at walls.
const FRAGMENT_REACH = 450;

export function blastExposed(world, frag, tank, clear) {
  if (distance(frag, tank) > FRAGMENT_REACH + 15) return false;
  // A wall protecting only the tank's center can still expose its sides.
  for (let i = 0; i <= 8; i++) {
    const point = i === 8 ? tank : { x: tank.x + Math.cos(i * Math.PI / 4) * 14,
      y: tank.y + Math.sin(i * Math.PI / 4) * 14 };
    if (clear(world, frag, point, 0.5)) return true;
  }
  return false;
}

export function choosePickup({ world, tank, name, opponents, target, search, cellIndex, searchMaze, clear, previousId }) {
  if ((tank.weapon || "default") !== "default" || !world.pickups.length) return null;
  const own = Object.values(world.bullets).filter((bullet) => bullet.shooter === name);
  if (own.some((bullet) => bullet.weapon_type === "frag")) return null;
  const occupied = own.some((bullet) => (bullet.weapon_type || "default") === "default");
  const enemyDistances = opponents.map(([, other]) => ({ tank: other, search: searchMaze(world, other) }));
  const targetSearch = target ? enemyDistances.find(({ tank: other }) => other === target)?.search : null;
  const directSteps = target ? search.distances[cellIndex(world, target)] : 0;
  let best = null;
  for (const pickup of world.pickups) {
    if (!KNOWN_ITEMS.has(pickup.type)) continue;
    const steps = search.distances[cellIndex(world, pickup)];
    if (steps < 0 || steps > 4) continue;
    const after = targetSearch?.distances[cellIndex(world, pickup)] ?? 0;
    const detour = target ? Math.max(0, steps + after - directSteps) : steps;
    if (detour > 4) continue;
    let value = pickup.type === "laser" ? 8 : pickup.type === "misile" ? 7 : 5;
    if (occupied) value += 3;
    if (own.some((bullet) => bullet.weapon_type === pickup.type)) value -= 4;
    if (pickup.type === "frag" && target) {
      const clustered = opponents.filter(([, other]) => distance(other, target) < 120).length > 1;
      value += clustered ? 3 : 0;
      // Frags reward cover and clustered targets; a close open duel favors laser.
      if (distance(pickup, target) < 140 && clear(world, pickup, target, 4)) value -= 4;
    }
    let danger = 0;
    for (const { tank: enemy, search: enemySearch } of enemyDistances) {
      const enemySteps = enemySearch.distances[cellIndex(world, pickup)];
      if (enemySteps >= 0 && enemySteps < steps) danger += 2;
      if (distance(enemy, pickup) < 100 && clear(world, enemy, pickup, 4)) danger += 6;
    }
    // Do not cross an imminent bullet lane just to collect an item.
    for (const bullet of Object.values(world.bullets)) {
      if (!Math.hypot(bullet.vx, bullet.vy)) continue;
      const time = Math.max(0, Math.min(0.5, ((pickup.x - bullet.x) * bullet.vx
        + (pickup.y - bullet.y) * bullet.vy) / (bullet.vx ** 2 + bullet.vy ** 2)));
      const point = { x: bullet.x + bullet.vx * time, y: bullet.y + bullet.vy * time };
      if (time <= bullet.lifetime && distance(point, pickup) < 35 && clear(world, bullet, point)) danger += 8;
    }
    const score = value - steps * 1.25 - detour * 0.8 - danger
      + (pickup.id === previousId ? 1 : 0) - distance(tank, pickup) / world.cellSize * 0.15;
    if (score > 0 && (!best || score > best.score)) best = { pickup, score };
  }
  return best?.pickup ?? null;
}

export function findFragCover(world, tank, frag, search, clear) {
  if (!blastExposed(world, frag, tank, clear)) return { ...tank };
  let best = null;
  const width = world.maze[0].length;
  for (let index = 0; index < search.distances.length; index++) {
    const steps = search.distances[index];
    if (steps < 0 || steps > 4) continue;
    const point = { x: (index % width + 0.5) * world.cellSize,
      y: (Math.floor(index / width) + 0.5) * world.cellSize };
    if (distance(point, frag) < 45 || blastExposed(world, frag, point, clear)) continue;
    const score = steps + distance(tank, point) / world.cellSize * 0.25;
    if (!best || score < best.score) best = { ...point, score };
  }
  return best;
}

export function retreatFrom(world, tank, danger, clear, canOccupy) {
  const bearing = Math.atan2(danger.y - tank.y, danger.x - tank.x);
  const actions = [{ angle: bearing, drive: -0.65 },
    { angle: bearing + Math.PI / 2, drive: 1 }, { angle: bearing - Math.PI / 2, drive: 1 }];
  let best = null;
  for (const action of actions) {
    const end = { ...tank, angle: action.angle, x: tank.x + Math.cos(action.angle) * 45 * action.drive,
      y: tank.y + Math.sin(action.angle) * 45 * action.drive };
    if (!canOccupy(end) || !clear(world, tank, end, 22)) continue;
    const score = distance(end, danger) - distance(tank, danger)
      - Math.abs(angleDifference(action.angle, tank.angle)) * 8;
    if (!best || score > best.score) best = { ...action, score };
  }
  return best;
}

export function shouldDetonateFrag(world, tank, frag, opponents, observations, clear, canOccupy) {
  if (!frag || opponents.length === 0) return false;
  const nearby = opponents.map(([name, other]) => {
    const velocity = observations.get(name)?.velocity || { x: 0, y: 0 };
    const dx = other.x - frag.x, dy = other.y - frag.y;
    const closing = dx * (velocity.x - frag.vx) + dy * (velocity.y - frag.vy);
    return { other, range: distance(other, frag), closing };
  }).filter(({ other, range }) => range < 100 && clear(world, frag, other, 2));
  if (!nearby.length) return false;
  const safe = !blastExposed(world, frag, tank, clear);
  // In open terrain, require substantial separation and room to evade the
  // eventual fragments. Cover or being beyond fragment range is preferable.
  const escape = retreatFrom(world, tank, frag, clear, canOccupy);
  if (!safe && (distance(tank, frag) < 240 || !escape)) return false;
  return nearby.length > 1 || nearby.some(({ range, closing }) => range < 55 || closing >= 0)
    || frag.lifetime < 0.18;
}

export function canLaunchFrag(world, tank, target, velocity, clear, canOccupy, queryWalls) {
  if (!target) return false;
  // A protected shooter can use a frag across a nearby wall. In an open duel,
  // first make room to retreat rather than exploding a grenade at its own feet.
  if (distance(tank, target) < 145 && blastExposed(world, target, tank, clear)) return false;
  const bullet = { ...bulletSpawnPosition(tank, world.wallRects, queryWalls),
    vx: Math.cos(tank.angle) * 150, vy: Math.sin(tank.angle) * 150, weapon_type: "frag" };
  const enemy = { ...target };
  for (let time = 0; time < 2.5; time += 1 / 30) {
    const moved = { ...enemy, x: enemy.x + velocity.x / 30, y: enemy.y + velocity.y / 30 };
    if (canOccupy(moved)) { enemy.x = moved.x; enemy.y = moved.y; }
    const next = stepBullet(bullet, 1 / 30, world.wallRects, queryWalls);
    bullet.x = next.nextX; bullet.y = next.nextY;
    if (distance(bullet, tank) < 19) return false;
    if (distance(bullet, enemy) < 80 && clear(world, bullet, enemy, 2)) return true;
  }
  return false;
}
