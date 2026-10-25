import assert from "node:assert/strict";
import test from "node:test";
import { stepBullet } from "../static/js/bullet-physics.js";
import { steerMisile, MISILE_TURN_RATE, MISILE_HOMING_DELAY, MISILE_HOMING_DURATION } from "../static/js/misile.js";

globalThis.window = { addEventListener() {} };
const { STATE } = await import("../static/js/state.js");
const { createBulletManager } = await import("../static/js/bullets.js");

const missile = (extra = {}) => ({
  x: 0, y: 0, vx: 240, vy: 0, shooter: "Shooter", weapon_type: "misile",
  age: 0, lifetime: MISILE_HOMING_DELAY + MISILE_HOMING_DURATION, ...extra,
});
const heading = (bullet) => Math.atan2(bullet.vy, bullet.vx);
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);

test("misile flies straight for two seconds, then starts turning with only the elapsed homing time", () => {
  const bullet = missile();
  const tanks = { Enemy: { x: 0, y: 100 } };
  steerMisile(bullet, 1.9, tanks);
  close(heading(bullet), 0);
  steerMisile(bullet, 0.2, tanks);
  close(heading(bullet), MISILE_TURN_RATE * 0.1);
  close(Math.hypot(bullet.vx, bullet.vy), 240);
});

test("homing initially steers away from a blocked direct path toward the maze opening", () => {
  const { maze } = mazeFixture([[0, 0], [0, 1], [1, 1], [1, 0]]);
  const angle = Math.PI / 4;
  const bullet = missile({ age: MISILE_HOMING_DELAY, x: 35, y: 35,
    vx: 240 * Math.cos(angle), vy: 240 * Math.sin(angle) });
  const tanks = { Enemy: { x: 105, y: 35 } };
  steerMisile(bullet, 0.1, tanks, maze, 70);
  // Direct homing would turn upward toward the enemy behind the right wall.
  // Navigation must instead turn downward toward the opening below.
  assert.ok(heading(bullet) > angle);
});

function mazeFixture(path) {
  const width = Math.max(...path.map(([x]) => x)) + 1;
  const height = Math.max(...path.map(([, y]) => y)) + 1;
  const maze = Array.from({ length: height }, () => Array.from({ length: width }, () =>
    ({ top: true, bottom: true, left: true, right: true })));
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    if (bx > ax) { maze[ay][ax].right = false; maze[by][bx].left = false; }
    if (bx < ax) { maze[ay][ax].left = false; maze[by][bx].right = false; }
    if (by > ay) { maze[ay][ax].bottom = false; maze[by][bx].top = false; }
    if (by < ay) { maze[ay][ax].top = false; maze[by][bx].bottom = false; }
  }
  const walls = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = maze[y][x];
    for (const side of ["top", "bottom"]) if (cell[side]) {
      walls.push({ x: x * 70 - 1.4, y: (y + (side === "bottom" ? 1 : 0)) * 70 - 2.5,
        w: 72.8, h: 5 });
    }
    for (const side of ["left", "right"]) if (cell[side]) {
      walls.push({ x: (x + (side === "right" ? 1 : 0)) * 70 - 2.5, y: y * 70 - 1.4,
        w: 5, h: 72.8 });
    }
  }
  return { maze, walls };
}

function flyRoute(path, fps, angle, offset = { x: 0, y: 0 }) {
  const { maze, walls } = mazeFixture(path);
  const [sx, sy] = path[0], [tx, ty] = path.at(-1);
  const bullet = missile({ age: MISILE_HOMING_DELAY, x: (sx + 0.5) * 70 + offset.x, y: (sy + 0.5) * 70 + offset.y,
    vx: 240 * Math.cos(angle), vy: 240 * Math.sin(angle) });
  const target = { x: (tx + 0.5) * 70, y: (ty + 0.5) * 70 };
  const visited = new Set([`${sx},${sy}`]);
  for (let frame = 0; frame < fps * 10; frame++) {
    // Match the live manager's maximum distance per physics step.
    const steps = Math.max(1, Math.ceil(Math.max(240, Math.hypot(bullet.vx, bullet.vy)) / fps / 5));
    for (let i = 0; i < steps; i++) {
      const previous = { x: Math.floor(bullet.x / 70), y: Math.floor(bullet.y / 70) };
      const next = stepBullet(bullet, 1 / fps / steps, walls, null, null, { Enemy: target }, maze, 70);
      bullet.x = next.nextX; bullet.y = next.nextY;
      close(Math.hypot(bullet.vx, bullet.vy), 240);
      assert.equal(next.hitWall, false);
      const current = { x: Math.floor(bullet.x / 70), y: Math.floor(bullet.y / 70) };
      assert.ok(maze[current.y]?.[current.x], "missile must stay inside the maze");
      if (current.x !== previous.x) {
        assert.equal(maze[previous.y][previous.x][current.x > previous.x ? "right" : "left"], false,
          "missile must cross only open walls");
      }
      if (current.y !== previous.y) {
        assert.equal(maze[previous.y][previous.x][current.y > previous.y ? "bottom" : "top"], false,
          "missile must cross only open walls");
      }
      visited.add(`${current.x},${current.y}`);
      if (Math.hypot(bullet.x - target.x, bullet.y - target.y) < 15) return { visited, seconds: frame / fps };
    }
  }
  assert.fail(`Missile failed to reach the target at ${fps} FPS, heading ${angle}; ended at ${bullet.x}, ${bullet.y}`);
}

test("misile completes a detour around a wall at different refresh rates and initial headings", () => {
  const path = [[0, 0], [0, 1], [1, 1], [2, 1], [2, 0]];
  for (const fps of [30, 60, 144]) for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const { visited } = flyRoute(path, fps, angle);
    assert.ok(visited.has("0,1"));
    assert.ok(visited.has("1,1"));
  }
});

test("misile navigates successive maze corners before its homing phase expires", () => {
  const path = [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 1], [3, 1]];
  for (const fps of [30, 60, 144]) {
    const { visited } = flyRoute(path, fps, Math.PI / 2);
    for (const [x, y] of path) assert.ok(visited.has(`${x},${y}`));
  }
});

test("homing recovers from an off-center position near a closed wall", () => {
  const path = [[0, 0], [0, 1], [1, 1], [2, 1], [2, 0]];
  for (const fps of [30, 144]) {
    flyRoute(path, fps, 0, { x: 25, y: -15 });
  }
});

test("maze homing preserves cruise speed while turning in an open corridor", () => {
  const { maze } = mazeFixture([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  const bullet = missile({ age: MISILE_HOMING_DELAY, x: 35, y: 35, vx: 0, vy: 240 });
  const tanks = { Enemy: { x: 315, y: 35 } };
  steerMisile(bullet, 0.1, tanks, maze, 70);
  close(Math.hypot(bullet.vx, bullet.vy), 240);
  bullet.vx = 240; bullet.vy = 0;
  steerMisile(bullet, 0.1, tanks, maze, 70);
  close(Math.hypot(bullet.vx, bullet.vy), 240);
});

test("an unreachable target never produces steering through a sealed maze wall", () => {
  const { maze } = mazeFixture([[0, 0], [1, 0]]);
  maze[0][0].right = true;
  maze[0][1].left = true;
  const bullet = missile({ age: MISILE_HOMING_DELAY, x: 35, y: 35, vx: 0, vy: 240 });
  steerMisile(bullet, 0.1, { Enemy: { x: 105, y: 35 } }, maze, 70);
  close(bullet.vx, 0);
  close(bullet.vy, 240);
});

test("homing chooses the nearest living opponent and reacquires as tanks move or die", () => {
  const bullet = missile({ age: MISILE_HOMING_DELAY });
  const tanks = {
    Shooter: { x: 0, y: -1 },
    Dead: { x: 0, y: -2, alive: false },
    Near: { x: 0, y: 50 },
    Far: { x: 0, y: -100 },
  };
  steerMisile(bullet, 0.1, tanks);
  close(heading(bullet), MISILE_TURN_RATE * 0.1);
  tanks.Far.y = -10;
  steerMisile(bullet, 0.1, tanks);
  close(heading(bullet), 0);
  tanks.Far.alive = false;
  steerMisile(bullet, 0.1, tanks);
  close(heading(bullet), MISILE_TURN_RATE * 0.1);
});

test("misile takes the shortest turn across the angle boundary and never snaps to the target", () => {
  const angle = Math.PI - 0.01;
  const bullet = missile({ age: MISILE_HOMING_DELAY, vx: 240 * Math.cos(angle), vy: 240 * Math.sin(angle) });
  const target = { Enemy: { x: -100, y: -100 } };
  steerMisile(bullet, 0.1, target);
  const change = Math.atan2(Math.sin(heading(bullet) - angle), Math.cos(heading(bullet) - angle));
  close(change, MISILE_TURN_RATE * 0.1);
});

test("homing ricochets retain speed and continue loose steering after each bounce", () => {
  const bullet = missile({ age: MISILE_HOMING_DELAY, x: 50, y: 100 });
  const walls = [{ x: 0, y: -10000, w: 5, h: 20000 }, { x: 100, y: -10000, w: 5, h: 20000 }];
  const tanks = { Enemy: { x: 500, y: 10000 } };
  let bounces = 0;
  for (let i = 0; i < 180; i++) {
    const previous = bullet.vx;
    const next = stepBullet(bullet, 1 / 120, walls, null, null, tanks);
    if (previous * bullet.vx < 0) bounces++;
    bullet.x = next.nextX; bullet.y = next.nextY;
    assert.equal(next.hitWall, false);
    assert.ok(bullet.x > 5 && bullet.x < 100);
    close(Math.hypot(bullet.vx, bullet.vy), 240);
  }
  assert.ok(bounces >= 2, `expected repeated bounces, got ${bounces}`);
});

test("no available target preserves heading and ordinary shots never acquire homing", () => {
  const bullet = missile({ age: MISILE_HOMING_DELAY });
  steerMisile(bullet, 1, { Shooter: { x: 1, y: 1 }, Dead: { x: 0, y: 20, alive: false } });
  close(heading(bullet), 0);
  const ordinary = missile({ weapon_type: "default" });
  const before = { ...ordinary };
  steerMisile(ordinary, 8, { Enemy: { x: 0, y: 100 } });
  assert.deepEqual(ordinary, before);
});

test("misile expires after the two-second delay plus five seconds of homing", () => {
  Object.assign(STATE, { gameCode: "TEST", playerName: "Shooter", isHost: false,
    bots: [], wallsReady: false, wallRects: [], tanks: {}, bullets: { shot: missile() } });
  const events = [];
  const manager = createBulletManager({ emit: (name, data) => events.push({ name, data }) });
  for (let i = 0; i < 69; i++) manager.update(0.1);
  assert.ok(STATE.bullets.shot);
  manager.update(0.100001);
  assert.equal(STATE.bullets.shot, undefined);
  assert.ok(events.some(({ name, data }) => name === "bullet_remove" && data.bullet_id === "shot"));
});

test("owner state updates are throttled and host-owned bot missiles use the same authority", () => {
  Object.assign(STATE, { gameCode: "TEST", playerName: "Host", isHost: true,
    bots: ["Bot 1"], wallsReady: false, wallRects: [], tanks: {}, bullets: {
      bot: missile({ shooter: "Bot 1" }), remote: missile({ shooter: "Remote" }),
    } });
  const events = [];
  const manager = createBulletManager({ emit: (name, data) => events.push({ name, data }) });
  for (let i = 0; i < 144; i++) manager.update(1 / 144);
  const updates = events.filter(({ name }) => name === "bullet_state");
  assert.ok(updates.length >= 15 && updates.length <= 21);
  assert.ok(updates.every(({ data }) => data.bullet_id === "bot"));
});
