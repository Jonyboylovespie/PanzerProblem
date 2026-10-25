import { bulletSpawnPosition, stepBullet } from "./bullet-physics.js";

export function predictLaserPath(tank, cellSize, walls, queryWalls = null) {
  if (!tank || tank.alive === false || tank.weapon !== "laser") return [];

  const bullet = {
    ...bulletSpawnPosition(tank, walls, queryWalls),
    vx: Math.cos(tank.angle),
    vy: Math.sin(tank.angle),
    weapon_type: "laser",
  };
  const path = [{ x: bullet.x, y: bullet.y }];
  // Four maze cells gives a useful aiming guide without revealing the full shot.
  const length = (cellSize > 0 ? cellSize : 70) * 4;
  for (let distance = 0; distance < length; distance += 5) {
    const result = stepBullet(bullet, Math.min(5, length - distance), walls, queryWalls, path);
    bullet.x = result.nextX;
    bullet.y = result.nextY;
    if (result.hitWall) break;
  }
  return path;
}
