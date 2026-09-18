import assert from "node:assert/strict";
import test from "node:test";
import { stepBullet } from "../static/js/bullet-physics.js";

test("a shot spawned just before a wall ricochets on the same side", () => {
  for (const weapon_type of ["default", "frag", "laser"]) {
    const bullet = { x: 67.49, y: 35, vx: 300, vy: 0, weapon_type };
    const result = stepBullet(bullet, 1 / 60, [{ x: 67.5, y: 0, w: 5, h: 70 }]);
    assert.equal(result.hitWall, false);
    assert.ok(result.nextX < 67.5);
    assert.equal(bullet.vx, -300);
  }
});

test("fast bullets cannot tunnel through a wall between frames", () => {
  const bullet = { x: 30, y: 35, vx: 1500, vy: 0, weapon_type: "laser" };
  const result = stepBullet(bullet, 0.05, [{ x: 67.5, y: 0, w: 5, h: 70 }]);
  assert.ok(result.nextX < 67.5);
  assert.equal(bullet.vx, -1500);
});

test("diagonal shots hit corners even when both endpoint axis tests miss", () => {
  const bullet = { x: 9, y: 9, vx: 120, vy: 120 };
  const result = stepBullet(bullet, 1 / 60, [{ x: 10, y: 10, w: 5, h: 20 }]);
  assert.ok(result.nextX < 10 && result.nextY < 10);
  assert.equal(bullet.vx, -120);
  assert.equal(bullet.vy, -120);
});

test("fragments disappear on wall impact", () => {
  const bullet = { x: 5, y: 20, vx: 300, vy: 0, weapon_type: "fragment" };
  assert.equal(stepBullet(bullet, 0.1, [{ x: 10, y: 0, w: 5, h: 30 }]).hitWall, true);
});

test("the nearest wall wins regardless of wall order", () => {
  const bullet = { x: 0, y: 20, vx: 300, vy: 0 };
  const result = stepBullet(bullet, 0.1, [
    { x: 20, y: 0, w: 5, h: 30 }, { x: 10, y: 0, w: 5, h: 30 },
  ]);
  assert.ok(Math.abs(result.nextX - (-10.01)) < 1e-8);
});

test("a bounced projectile leaves the wall instead of getting stuck", () => {
  const bullet = { x: 10, y: 20, vx: -300, vy: 0 };
  const result = stepBullet(bullet, 1 / 60, [{ x: 10, y: 0, w: 5, h: 30 }]);
  assert.equal(result.nextX, 5);
  assert.equal(bullet.vx, -300);
});

test("open paths preserve velocity and expected distance", () => {
  const bullet = { x: 0, y: 0, vx: 300, vy: 150 };
  const result = stepBullet(bullet, 0.01, [{ x: 10, y: 20, w: 5, h: 30 }]);
  assert.deepEqual(result, { nextX: 3, nextY: 1.5, hitWall: false });
  assert.equal(bullet.vx, 300);
  assert.equal(bullet.vy, 150);
});

test("ricochet distance is consistent at 60 and 144 FPS", () => {
  const simulate = (fps) => {
    const bullet = { x: 30, y: 35, vx: 300, vy: 0 };
    for (let frame = 0; frame < fps; frame++) {
      const result = stepBullet(bullet, 1 / fps, [{ x: 67.5, y: 0, w: 5, h: 70 }]);
      bullet.x = result.nextX;
      bullet.y = result.nextY;
    }
    return bullet;
  };
  assert.ok(Math.abs(simulate(60).x - simulate(144).x) < 1e-8);
});
