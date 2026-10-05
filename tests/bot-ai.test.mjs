import assert from "node:assert/strict";
import test from "node:test";
import { createBotController, findMazePath, hasClearPath, predictIntercept } from "../static/js/bot-ai.js";
import { stepBullet } from "../static/js/bullet-physics.js";

// The collision module imports the renderer, whose only initialization here is
// its theme listener. Simulations use the actual game tank and wall collisions.
globalThis.window = { addEventListener() {} };
const { STATE } = await import("../static/js/state.js");
const { tankCollides } = await import("../static/js/maze.js");
const { attemptMoveAndResolve, attemptRotate } = await import("../static/js/movement.js");

function fixture(width, height, passages = null) {
  const maze = Array.from({ length: height }, () => Array.from({ length: width }, () =>
    ({ top: true, right: true, bottom: true, left: true })));
  const connect = ([ax, ay], [bx, by]) => {
    if (bx > ax) { maze[ay][ax].right = false; maze[by][bx].left = false; }
    if (bx < ax) { maze[ay][ax].left = false; maze[by][bx].right = false; }
    if (by > ay) { maze[ay][ax].bottom = false; maze[by][bx].top = false; }
    if (by < ay) { maze[ay][ax].top = false; maze[by][bx].bottom = false; }
  };
  if (passages) {
    for (let i = 1; i < passages.length; i++) connect(passages[i - 1], passages[i]);
  } else {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x + 1 < width) connect([x, y], [x + 1, y]);
      if (y + 1 < height) connect([x, y], [x, y + 1]);
    }
  }
  const wallRects = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = maze[y][x];
    if (cell.top) wallRects.push({ x: x * 70 - 1.4, y: y * 70 - 2.5, w: 72.8, h: 5 });
    if (cell.bottom) wallRects.push({ x: x * 70 - 1.4, y: (y + 1) * 70 - 2.5, w: 72.8, h: 5 });
    if (cell.left) wallRects.push({ x: x * 70 - 2.5, y: y * 70 - 1.4, w: 5, h: 72.8 });
    if (cell.right) wallRects.push({ x: (x + 1) * 70 - 2.5, y: y * 70 - 1.4, w: 5, h: 72.8 });
  }
  const world = { maze, cellSize: 70, wallRects, tanks: {}, pickups: [], bullets: {} };
  Object.assign(STATE, world, { wallsReady: true });
  return world;
}

const tank = (x, y, angle = 0) => ({ x, y, angle, weapon: "default", alive: true });
const brain = () => createBotController({
  move: attemptMoveAndResolve,
  rotate: attemptRotate,
  canOccupy: (value) => !tankCollides(value),
});

function reachShot(world, fps, timeout = 15) {
  const controller = brain();
  const visited = new Set();
  for (let frame = 0; frame < fps * timeout; frame++) {
    const action = controller.update(world, "Bot", frame * 1000 / fps, 1 / fps);
    const bot = world.tanks.Bot;
    assert.equal(tankCollides(bot), false, "bot must never cross a wall");
    visited.add(`${Math.floor(bot.x / 70)},${Math.floor(bot.y / 70)}`);
    if (action.shoot) {
      const muzzle = { x: bot.x + Math.cos(bot.angle) * 25, y: bot.y + Math.sin(bot.angle) * 25 };
      assert.ok(hasClearPath(muzzle, world.tanks.Enemy, world.wallRects, 4));
      return { seconds: frame / fps, visited };
    }
  }
  assert.fail(`Bot did not reach a firing position after ${timeout} seconds`);
}

test("bots route around an interior wall and reach a firing position at different frame rates", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(3, 2, [[0, 0], [0, 1], [1, 1], [2, 1], [2, 0]]);
    world.tanks = { Bot: tank(35, 35), Enemy: tank(175, 35) };
    assert.equal(hasClearPath(world.tanks.Bot, world.tanks.Enemy, world.wallRects), false);
    assert.equal(findMazePath(world, world.tanks.Bot, world.tanks.Enemy).length, 5);
    const reached = reachShot(world, fps);
    assert.ok(reached.seconds < 8);
    assert.ok(reached.visited.has("0,1"));
    assert.ok(reached.visited.has("1,1"));
  }
});

test("bots negotiate successive tight corners instead of circling or cutting through them", () => {
  const world = fixture(5, 4, [
    [0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 1],
    [3, 1], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3],
  ]);
  world.tanks = { Bot: tank(35, 35), Enemy: tank(315, 245) };
  const reached = reachShot(world, 60, 25);
  assert.ok(reached.visited.size >= 9);
});

test("intercept aiming leads a moving opponent by the projectile travel time", () => {
  const origin = { x: 0, y: 0 };
  const target = { x: 200, y: 0 };
  const prediction = predictIntercept(origin, target, { x: 0, y: 100 }, 300);
  const flightTime = Math.hypot(prediction.x, prediction.y) / 300;
  assert.ok(prediction.y > 60);
  assert.ok(Math.abs(prediction.y - flightTime * 100) < 1e-8);
  const laser = predictIntercept(origin, target, { x: 0, y: 100 }, 1500);
  assert.ok(laser.y < prediction.y);
  assert.deepEqual(predictIntercept(origin, target, { x: 400, y: 0 }, 300), target);
});

test("bots take an evasive path when a projectile is about to cross their position", () => {
  const world = fixture(5, 5);
  world.tanks = { Bot: tank(175, 175, Math.PI / 2), Enemy: tank(315, 175) };
  const bullet = { x: 85, y: 175, vx: 300, vy: 0, lifetime: 5, shooter: "Enemy" };
  world.bullets = { incoming: bullet };
  const controller = brain();
  let closest = Infinity;
  for (let frame = 0; frame < 35; frame++) {
    controller.update(world, "Bot", frame * 1000 / 60, 1 / 60);
    bullet.x += bullet.vx / 60;
    bullet.lifetime -= 1 / 60;
    closest = Math.min(closest, Math.hypot(bullet.x - world.tanks.Bot.x, bullet.y - world.tanks.Bot.y));
    assert.equal(tankCollides(world.tanks.Bot), false);
  }
  assert.ok(closest > 18, `Projectile passed within ${closest} pixels`);
  assert.ok(world.tanks.Bot.y > 200);
});

test("bots collect a nearby weapon on their route to an opponent", () => {
  const world = fixture(3, 2, [[0, 0], [0, 1], [1, 1], [2, 1], [2, 0]]);
  world.tanks = { Bot: tank(35, 35), Enemy: tank(175, 35) };
  world.pickups = [{ id: "laser", x: 35, y: 105, type: "laser" }];
  const controller = brain();
  let claimed = false;
  for (let frame = 0; frame < 240; frame++) {
    const action = controller.update(world, "Bot", frame * 1000 / 60, 1 / 60);
    if (action.pickupId) { assert.equal(action.pickupId, "laser"); claimed = true; break; }
  }
  assert.ok(claimed);
});

test("frag detonation waits until it is near an opponent and safely away from the bot", () => {
  for (const [fragX, expected] of [[220, true], [60, false]]) {
    const world = fixture(5, 3);
    world.tanks = { Bot: { ...tank(35, 105), weapon: "frag" }, Enemy: tank(245, 105) };
    world.bullets = { frag: { x: fragX, y: 105, vx: 150, vy: 0, lifetime: 5, shooter: "Bot", weapon_type: "frag" } };
    const controller = brain();
    controller.update(world, "Bot", 0, 1 / 60);
    assert.equal(controller.update(world, "Bot", 250, 1 / 60).shoot, expected);
  }
});

test("bots hold fire while their current weapon already has a projectile in flight", () => {
  const world = fixture(5, 3);
  world.tanks = { Bot: tank(35, 105), Enemy: tank(245, 105) };
  world.bullets = { shot: { x: 100, y: 105, vx: 300, vy: 0, lifetime: 5, shooter: "Bot", weapon_type: "default" } };
  const controller = brain();
  controller.update(world, "Bot", 0, 1 / 60);
  assert.equal(controller.update(world, "Bot", 250, 1 / 60).shoot, false);
});

test("new rounds clear old routes and dead opponents are never targeted", () => {
  const controller = brain();
  let world = fixture(3, 2, [[0, 0], [0, 1], [1, 1], [2, 1], [2, 0]]);
  world.tanks = { Bot: tank(35, 35), Enemy: tank(175, 35) };
  for (let i = 0; i < 30; i++) controller.update(world, "Bot", i * 1000 / 60, 1 / 60);
  world = fixture(5, 3);
  world.tanks = { Bot: tank(35, 105), Enemy: tank(245, 105) };
  assert.equal(controller.update(world, "Bot", 600, 1 / 60).shoot, false);
  assert.equal(controller.update(world, "Bot", 850, 1 / 60).shoot, true);
  world.tanks.Enemy.alive = false;
  assert.equal(controller.update(world, "Bot", 1200, 1 / 60).shoot, false);
});

test("the first aimed shot intercepts an opponent moving across an open arena", () => {
  const world = fixture(7, 7);
  world.tanks = { Bot: tank(105, 245), Enemy: tank(315, 175, Math.PI / 2) };
  const controller = brain();
  let fired = false;
  let hit = false;
  for (let frame = 0; frame < 240; frame++) {
    const enemy = world.tanks.Enemy;
    attemptMoveAndResolve(enemy, 0, 100 / 60);
    const action = controller.update(world, "Bot", frame * 1000 / 60, 1 / 60);
    const bot = world.tanks.Bot;
    if (action.shoot && !fired) {
      fired = true;
      world.bullets.shot = {
        x: bot.x + Math.cos(bot.angle) * 25, y: bot.y + Math.sin(bot.angle) * 25,
        vx: Math.cos(bot.angle) * 300, vy: Math.sin(bot.angle) * 300,
        lifetime: 10, shooter: "Bot", weapon_type: "default",
      };
    }
    if (world.bullets.shot) {
      const bullet = world.bullets.shot;
      const next = stepBullet(bullet, 1 / 60, world.wallRects);
      bullet.x = next.nextX;
      bullet.y = next.nextY;
      if (Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y) < 15) { hit = true; break; }
    }
  }
  assert.ok(fired);
  assert.ok(hit, "The projectile must hit the moving target, rather than its old position");
});

test("bots find firing positions in generated mazes with different starting orientations", () => {
  for (let seed = 1; seed <= 20; seed++) {
    let randomState = seed;
    const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32; };
    const visited = new Set(["0,0"]);
    const trail = [[0, 0]];
    const carve = (x, y) => {
      const neighbors = [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]];
      for (let i = neighbors.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
      }
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= 7 || ny >= 7 || visited.has(`${nx},${ny}`)) continue;
        visited.add(`${nx},${ny}`);
        trail.push([nx, ny]);
        carve(nx, ny);
        trail.push([x, y]);
      }
    };
    carve(0, 0);
    const world = fixture(7, 7, trail);
    world.tanks = { Bot: tank(35, 35, seed * Math.PI / 2), Enemy: tank(455, 455) };
    reachShot(world, 60, 90);
  }
});
