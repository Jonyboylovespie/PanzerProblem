import assert from "node:assert/strict";
import test from "node:test";
import { bulletSpawnPosition, stepBullet } from "../static/js/bullet-physics.js";
import { predictLaserPath } from "../static/js/laser-preview.js";

const tank = { x: 35, y: 35, angle: 0, weapon: "laser", alive: true };

test("equipped laser previews four cells from the muzzle and follows rotation", () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4]) {
    const aimedTank = { ...tank, angle };
    const original = { ...aimedTank };
    const path = predictLaserPath(aimedTank, 70, []);
    assert.ok(Math.abs(path[0].x - (35 + 25 * Math.cos(angle))) < 1e-8);
    assert.ok(Math.abs(path[0].y - (35 + 25 * Math.sin(angle))) < 1e-8);
    assert.ok(Math.abs(path.at(-1).x - (35 + 305 * Math.cos(angle))) < 1e-8);
    assert.ok(Math.abs(path.at(-1).y - (35 + 305 * Math.sin(angle))) < 1e-8);
    assert.deepEqual(aimedTank, original);
  }
});

test("preview stops displaying when the laser is consumed or its holder dies", () => {
  for (const holder of [null, { ...tank, weapon: "default" }, { ...tank, weapon: "frag" },
                        { ...tank, alive: false }]) {
    assert.deepEqual(predictLaserPath(holder, 70, []), []);
  }
});

test("near-wall muzzle positions match server spawn clearance on every side", () => {
  const walls = [
    { x: -1.4, y: -2.5, w: 72.8, h: 5 },
    { x: -1.4, y: 67.5, w: 72.8, h: 5 },
    { x: -2.5, y: -1.4, w: 5, h: 72.8 },
    { x: 67.5, y: -1.4, w: 5, h: 72.8 },
  ];
  for (const [x, y, angle, expectedX, expectedY] of [
    [47.49, 35, 0, 67.49, 35],
    [22.51, 35, Math.PI, 2.51, 35],
    [35, 47.49, Math.PI / 2, 35, 67.49],
    [35, 22.51, -Math.PI / 2, 35, 2.51],
  ]) {
    const start = bulletSpawnPosition({ ...tank, x, y, angle }, walls);
    assert.ok(Math.abs(start.x - expectedX) < 1e-8);
    assert.ok(Math.abs(start.y - expectedY) < 1e-8);
  }
});

test("ricochet preview matches the actual laser simulation and marks wall turns", () => {
  const walls = [
    { x: 100, y: -100, w: 5, h: 200 },
    { x: 0, y: -100, w: 5, h: 200 },
  ];
  const path = predictLaserPath(tank, 70, walls);
  const bullet = { ...path[0], vx: 1500, vy: 0, weapon_type: "laser" };
  for (let i = 0; i < 56; i++) {
    const result = stepBullet(bullet, 5 / 1500, walls);
    bullet.x = result.nextX;
    bullet.y = result.nextY;
  }
  assert.ok(Math.abs(path.at(-1).x - bullet.x) < 1e-8);
  assert.ok(path.some((point) => Math.abs(point.x - 99.99) < 1e-8));
  assert.ok(path.some((point) => Math.abs(point.x - 5.01) < 1e-8));
  for (const point of path) assert.ok(point.x > 5 && point.x < 100);
});

test("diagonal corner previews reflect on both axes", () => {
  const holder = { ...tank, x: 40, y: 40, angle: Math.PI / 4 };
  const path = predictLaserPath(holder, 70, [{ x: 80, y: 80, w: 5, h: 30 }]);
  assert.ok(path.some((point) => Math.abs(point.x - 79.99) < 1e-8 &&
                                  Math.abs(point.y - 79.99) < 1e-8));
  assert.ok(path.at(-1).x < holder.x && path.at(-1).y < holder.y);
});

test("wall index queries produce the same preview as a full wall scan", () => {
  const walls = [{ x: 100, y: 0, w: 5, h: 100 }];
  let queries = 0;
  const path = predictLaserPath(tank, 70, [], () => { queries++; return walls; });
  assert.ok(queries > 0);
  assert.deepEqual(path, predictLaserPath(tank, 70, walls));
});
