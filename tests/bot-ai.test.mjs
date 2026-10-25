import assert from "node:assert/strict";
import test from "node:test";
import { createBotController, findMazePath, hasClearPath, predictIntercept } from "../static/js/bot-ai.js";
import { bulletSpawnPosition, stepBullet } from "../static/js/bullet-physics.js";
import { createRicochetPlanner, evaluateRicochet } from "../static/js/bot-shooting.js";

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
  // Keep ammunition occupied until direct sight is reached: these tests
  // exercise maze navigation independently of the new bank-shot option.
  world.bullets.navigation = { x: 0, y: 0, vx: 0, vy: 0, lifetime: 100,
    shooter: "Bot", weapon_type: "default" };
  for (let frame = 0; frame < fps * timeout; frame++) {
    if (hasClearPath(world.tanks.Bot, world.tanks.Enemy, world.wallRects, 4)) delete world.bullets.navigation;
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

test("bots collect nearby laser and misile pickups on their route and fire the equipped weapon", () => {
  for (const type of ["laser", "misile"]) {
    const world = fixture(3, 2, [[0, 0], [0, 1], [1, 1], [2, 1], [2, 0]]);
    world.tanks = { Bot: tank(35, 35), Enemy: tank(175, 35) };
    world.pickups = [{ id: type, x: 35, y: 105, type }];
    world.bullets.navigation = { x: 0, y: 0, vx: 0, vy: 0, lifetime: 100,
      shooter: "Bot", weapon_type: "default" };
    const controller = brain();
    let claimed = false;
    let fired = false;
    for (let frame = 0; frame < 720; frame++) {
      const action = controller.update(world, "Bot", frame * 1000 / 60, 1 / 60);
      if (action.pickupId) {
        assert.equal(action.pickupId, type);
        claimed = true;
        world.tanks.Bot.weapon = type;
        world.pickups = [];
      }
      if (action.shoot) {
        assert.equal(world.tanks.Bot.weapon, type);
        fired = true;
        break;
      }
    }
    assert.ok(claimed, `Bot must collect the ${type} pickup`);
    assert.ok(fired, `Bot must fire its collected ${type} weapon`);
  }
});

test("frag detonation waits until it is near an opponent and safely away from the bot", () => {
  for (const [fragX, enemyX, expected] of [[520, 545, true], [60, 245, false], [220, 245, false]]) {
    const world = fixture(9, 3);
    world.tanks = { Bot: { ...tank(35, 105), weapon: "frag" }, Enemy: tank(enemyX, 105) };
    world.bullets = { frag: { x: fragX, y: 105, vx: 150, vy: 0, lifetime: 5, shooter: "Bot", weapon_type: "frag" } };
    const controller = brain();
    assert.equal(controller.update(world, "Bot", 0, 1 / 60).shoot, expected);
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

test("bots steer while driving through open space instead of finishing every turn first", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(7, 5);
    world.tanks = { Bot: tank(105, 175, Math.PI / 3), Enemy: tank(385, 175) };
    const controller = brain();
    let travelWhileTurning = 0;
    for (let frame = 0; frame < fps; frame++) {
      const before = { ...world.tanks.Bot };
      controller.update(world, "Bot", frame * 1000 / fps, 1 / fps);
      const bot = world.tanks.Bot;
      if (Math.abs(before.angle - bot.angle) > 0.001 && Math.abs(bot.angle) > 0.1) {
        travelWhileTurning += Math.hypot(bot.x - before.x, bot.y - before.y);
      }
      assert.equal(tankCollides(bot), false);
    }
    assert.ok(travelWhileTurning > 10, `Only ${travelWhileTurning} pixels while turning at ${fps} FPS`);
  }
});

test("bots accelerate smoothly without exceeding their original movement speed", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(7, 3);
    world.tanks = { Bot: tank(105, 105), Enemy: tank(455, 105) };
    const controller = brain();
    const speeds = [];
    for (let frame = 0; frame < fps / 4; frame++) {
      const before = { ...world.tanks.Bot };
      controller.update(world, "Bot", frame * 1000 / fps, 1 / fps);
      const bot = world.tanks.Bot;
      const speed = Math.hypot(bot.x - before.x, bot.y - before.y) * fps;
      assert.ok(speed <= 135 + 1e-6);
      if (speeds.length) assert.ok(speed - speeds.at(-1) <= 900 / fps + 1e-6);
      speeds.push(speed);
    }
    assert.ok(speeds[0] < speeds.at(-1));
    assert.ok(speeds.at(-1) > 130);
  }
});

test("bots reposition during a shot's flight and resume their existing aim when it clears", () => {
  const world = fixture(7, 5);
  world.tanks = { Bot: tank(175, 175), Enemy: tank(315, 175) };
  // An outgoing shot safely on another lane still occupies the weapon slot.
  world.bullets = { shot: { x: 280, y: 35, vx: 300, vy: 0,
    lifetime: 10, shooter: "Bot", weapon_type: "default" } };
  const controller = brain();
  for (let frame = 0; frame < 60; frame++) {
    const action = controller.update(world, "Bot", frame * 1000 / 60, 1 / 60);
    assert.equal(action.shoot, false);
    assert.equal(tankCollides(world.tanks.Bot), false);
    world.bullets.shot.x += 5;
  }
  assert.ok(Math.hypot(world.tanks.Bot.x - 175, world.tanks.Bot.y - 175) > 35);
  assert.ok(Math.abs(world.tanks.Bot.y - 175) > 20, "Repositioning should change lanes");
  world.bullets = {};
  let fired = false;
  for (let frame = 60; frame < 180; frame++) {
    const action = controller.update(world, "Bot", frame * 1000 / 60, 1 / 60);
    if (!action.shoot) continue;
    const bot = world.tanks.Bot;
    const expected = Math.atan2(world.tanks.Enemy.y - bot.y, world.tanks.Enemy.x - bot.x);
    assert.ok(Math.abs(Math.atan2(Math.sin(bot.angle - expected), Math.cos(bot.angle - expected))) < 0.1);
    fired = true;
    break;
  }
  assert.ok(fired, "Movement must not prevent the next aimed shot");
});

function simulateDodge(world, fps, seconds, inspect = () => {}) {
  const controller = brain();
  let closest = Infinity;
  for (let frame = 0; frame < fps * seconds; frame++) {
    const snapshot = structuredClone(world.bullets);
    const action = controller.update(world, "Bot", frame * 1000 / fps, 1 / fps);
    assert.deepEqual(world.bullets, snapshot, "Forecasting must not mutate live projectiles");
    assert.equal(tankCollides(world.tanks.Bot), false, "Escapes must respect tank and barrel collisions");
    inspect(world, frame / fps, action);
    for (const [id, bullet] of Object.entries(world.bullets)) {
      const substeps = Math.max(1, Math.ceil(Math.hypot(bullet.vx, bullet.vy) / fps / 5));
      for (let step = 0; step < substeps; step++) {
        bullet.lifetime -= 1 / fps / substeps;
        if (bullet.lifetime <= 0) { delete world.bullets[id]; break; }
        const next = stepBullet(bullet, 1 / fps / substeps, world.wallRects);
        if (next.hitWall) { delete world.bullets[id]; break; }
        bullet.x = next.nextX; bullet.y = next.nextY;
        closest = Math.min(closest, Math.hypot(bullet.x - world.tanks.Bot.x, bullet.y - world.tanks.Bot.y));
      }
    }
  }
  assert.ok(closest > 15, `An avoidable projectile passed within ${closest} pixels at ${fps} FPS`);
  return world.tanks.Bot;
}

test("bots anticipate their own ricochet before it bounces back toward them", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(5, 5);
    world.tanks = { Bot: tank(245, 175, Math.PI / 2) };
    world.bullets = { returning: { x: 300, y: 175, vx: 300, vy: 0,
      lifetime: 5, shooter: "Bot", weapon_type: "default" } };
    let movedBeforeBounce = false;
    simulateDodge(world, fps, 0.75, (state, time) => {
      if (time < 0.14 && Math.abs(state.tanks.Bot.y - 175) > 2) movedBeforeBounce = true;
    });
    assert.ok(movedBeforeBounce, "A bot should react before an outgoing shot reflects back at it");
  }
});

test("bots compare escape routes against simultaneous crossing projectiles", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(5, 5);
    world.tanks = { Bot: tank(175, 175, Math.PI / 2) };
    world.bullets = {
      horizontal: { x: 85, y: 175, vx: 300, vy: 0, lifetime: 5, shooter: "Enemy" },
      vertical: { x: 175, y: 275, vx: 0, vy: -300, lifetime: 5, shooter: "Enemy" },
    };
    simulateDodge(world, fps, 0.65);
  }
});

test("bots avoid walking into a bullet lane even when their current position is safe", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(7, 5);
    world.tanks = { Bot: tank(175, 175), Enemy: tank(385, 175) };
    world.bullets = { crossing: { x: 210, y: 85, vx: 0, vy: 300,
      lifetime: 5, shooter: "Enemy", weapon_type: "default" } };
    simulateDodge(world, fps, 0.5);
  }
});

test("bots reverse to dodge when a nearby wall blocks the forward escape", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(5, 5);
    world.tanks = { Bot: tank(175, 325, Math.PI / 2) };
    world.bullets = { incoming: { x: 85, y: 325, vx: 300, vy: 0,
      lifetime: 5, shooter: "Enemy", weapon_type: "fragment" } };
    const bot = simulateDodge(world, fps, 0.5);
    assert.ok(bot.y < 300, "Escape must use the open side of the corridor");
  }
});

test("bots dodge fast laser shots with the same physical movement limits", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(9, 5);
    world.tanks = { Bot: tank(455, 175, Math.PI / 2) };
    world.bullets = { laser: { x: 35, y: 175, vx: 1500, vy: 0,
      lifetime: 2, shooter: "Enemy", weapon_type: "laser" } };
    simulateDodge(world, fps, 0.45);
  }
});

test("bots ignore expired threats and bullets that remain behind cover", () => {
  for (const cover of [false, true]) {
    const world = fixture(5, 5);
    world.tanks = { Bot: tank(175, 175, Math.PI / 2) };
    if (cover) world.wallRects.push({ x: 140, y: 0, w: 5, h: 350 });
    world.bullets = { harmless: { x: 85, y: 175, vx: 300, vy: 0,
      lifetime: cover ? 5 : 0.05, shooter: "Enemy" } };
    const controller = brain();
    for (let frame = 0; frame < 30; frame++) {
      const action = controller.update(world, "Bot", frame * 1000 / 60, 1 / 60);
      assert.equal(action.changed, false);
      const bullet = world.bullets.harmless;
      if (!bullet) continue;
      bullet.lifetime -= 1 / 60;
      if (bullet.lifetime <= 0) { delete world.bullets.harmless; continue; }
      const next = stepBullet(bullet, 1 / 60, world.wallRects);
      bullet.x = next.nextX; bullet.y = next.nextY;
    }
  }
});

test("bots ignore their safely outgoing shots instead of dodging the muzzle", () => {
  const world = fixture(9, 5);
  world.tanks = { Bot: tank(175, 175) };
  world.bullets = { outgoing: { x: 200, y: 175, vx: 300, vy: 0,
    lifetime: 5, shooter: "Bot", weapon_type: "default" } };
  simulateDodge(world, 60, 0.5, (state, time, action) => {
    assert.equal(action.changed, false);
  });
});

test("a newly spawned shot interrupts the dodge decision throttle immediately", () => {
  const world = fixture(9, 5);
  world.tanks = { Bot: tank(455, 175, Math.PI / 2) };
  const controller = brain();
  assert.equal(controller.update(world, "Bot", 0, 1 / 144).changed, false);
  world.bullets = { newLaser: { x: 35, y: 175, vx: 1500, vy: 0,
    lifetime: 2, shooter: "Enemy", weapon_type: "laser" } };
  assert.equal(controller.update(world, "Bot", 1000 / 144, 1 / 144).changed, true);
  assert.ok(world.tanks.Bot.y > 175);
  const newRound = fixture(9, 5);
  newRound.tanks = { Bot: tank(455, 175, Math.PI / 2) };
  assert.equal(controller.update(newRound, "Bot", 2000 / 144, 1 / 144).changed, false,
    "New rounds must clear the old escape and velocity");
});

function bankArena(weapon = "default") {
  const world = fixture(5, 4);
  world.maze[1][1].right = true;
  world.maze[1][2].left = true;
  world.wallRects.push({ x: 137.5, y: 68.6, w: 5, h: 72.8 });
  world.tanks = { Bot: { ...tank(105, 105), weapon }, Enemy: tank(175, 105) };
  assert.equal(hasClearPath(world.tanks.Bot, world.tanks.Enemy, world.wallRects, 4), false);
  return world;
}

function hitWithBank(world, fps, velocity = { x: 0, y: 0 }) {
  const controller = brain();
  let fired = false;
  let bounces = 0;
  for (let frame = 0; frame < fps * 4; frame++) {
    const enemy = world.tanks.Enemy;
    attemptMoveAndResolve(enemy, velocity.x / fps, velocity.y / fps);
    const action = controller.update(world, "Bot", frame * 1000 / fps, 1 / fps);
    const bot = world.tanks.Bot;
    assert.equal(tankCollides(bot), false);
    if (action.shoot && !fired) {
      assert.equal(hasClearPath(bot, enemy, world.wallRects, 4), false,
        "The bot must fire while its target is still behind a wall");
      fired = true;
      const weapon = bot.weapon;
      const speed = { default: 300, frag: 150, laser: 2700 }[weapon];
      world.bullets.bank = { ...bulletSpawnPosition(bot, world.wallRects),
        vx: Math.cos(bot.angle) * speed, vy: Math.sin(bot.angle) * speed,
        lifetime: weapon === "laser" ? 0.75 : 10, shooter: "Bot", weapon_type: weapon };
    }
    if (!world.bullets.bank) continue;
    const bullet = world.bullets.bank;
    const substeps = Math.ceil(Math.hypot(bullet.vx, bullet.vy) / fps / 5);
    for (let i = 0; i < substeps; i++) {
      const vx = bullet.vx, vy = bullet.vy;
      const next = stepBullet(bullet, 1 / fps / substeps, world.wallRects);
      bullet.x = next.nextX; bullet.y = next.nextY;
      bullet.lifetime -= 1 / fps / substeps;
      if (vx !== bullet.vx || vy !== bullet.vy) bounces++;
      assert.ok(Math.hypot(bullet.x - bot.x, bullet.y - bot.y) > 15, "The shooter must survive its own bank shot");
      if (Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y) < 15) {
        assert.ok(bounces > 0);
        return bounces;
      }
    }
  }
  assert.fail(`The bot's ${world.tanks.Bot.weapon} bank shot did not hit at ${fps} FPS`);
}

test("bots hit opponents behind walls using ricochets with each weapon", () => {
  for (const weapon of ["default", "laser", "frag"]) for (const fps of [30, 60, 144]) {
    hitWithBank(bankArena(weapon), fps);
  }
});

test("bank shots lead opponents moving behind cover", () => {
  for (const fps of [30, 60, 144]) {
    const world = bankArena();
    world.tanks.Enemy.x = 210;
    hitWithBank(world, fps, { x: 30, y: 0 });
  }
});

test("bots can use two wall reflections to shoot around a blocked corner", () => {
  for (const fps of [30, 60, 144]) {
    const world = fixture(5, 5);
    world.wallRects.splice(0, world.wallRects.length,
      { x: 0, y: 0, w: 350, h: 5 }, { x: 0, y: 345, w: 350, h: 5 },
      { x: 0, y: 0, w: 5, h: 350 }, { x: 345, y: 0, w: 5, h: 350 },
      { x: 70, y: 70, w: 70, h: 5 }, { x: 115, y: 160, w: 70, h: 5 },
      { x: 70, y: 70, w: 5, h: 70 });
    world.tanks = { Bot: tank(175, 35), Enemy: tank(35, 105) };
    assert.equal(hitWithBank(world, fps), 2);
  }
});

test("banks that return through the shooter before reaching the enemy are rejected", () => {
  const world = fixture(5, 3);
  world.tanks = { Bot: tank(105, 105), Enemy: tank(35, 105) };
  assert.equal(evaluateRicochet(world, world.tanks.Bot, () => world.tanks.Enemy, 0), null);
});

test("planned banks are checked again if the shot becomes blocked or the target dies", () => {
  const world = bankArena();
  const planner = createRicochetPlanner({
    canOccupy: (value) => !tankCollides(value),
    clearPath: (world, from, to, padding) => hasClearPath(from, to, world.wallRects, padding),
  });
  const velocity = { x: 0, y: 0 };
  const shot = planner.update(world, world.tanks.Bot, world.tanks.Enemy, "Enemy", velocity, 0);
  assert.ok(shot);
  world.tanks.Bot.angle = shot.angle;
  assert.equal(planner.canFire(world, world.tanks.Bot, world.tanks.Enemy, velocity), true);
  world.wallRects.push({ x: 150, y: 0, w: 5, h: 280 });
  assert.equal(planner.canFire(world, world.tanks.Bot, world.tanks.Enemy, velocity), false);
  world.tanks.Enemy.alive = false;
  assert.equal(planner.update(world, world.tanks.Bot, world.tanks.Enemy, "Enemy", velocity, 10), null);
});

test("bots keep navigating when no ricochet can reach a sealed opponent", () => {
  const world = fixture(5, 4);
  world.tanks = { Bot: tank(35, 105), Enemy: tank(245, 105) };
  // The target's region is physically sealed, even though maze connectivity
  // still offers a route: the firing planner must respect the real geometry.
  world.wallRects.push({ x: 137.5, y: 0, w: 5, h: 280 });
  const controller = brain();
  for (let frame = 0; frame < 45; frame++) {
    assert.equal(controller.update(world, "Bot", frame * 1000 / 60, 1 / 60).shoot, false);
    assert.equal(tankCollides(world.tanks.Bot), false);
  }
  assert.ok(world.tanks.Bot.x > 70, "Failed bank planning must not freeze navigation");
});

test("an active projectile and an incoming threat still take priority over a bank shot", () => {
  const world = bankArena();
  world.bullets.occupied = { x: 0, y: 0, vx: 0, vy: 0,
    lifetime: 10, shooter: "Bot", weapon_type: "default" };
  const controller = brain();
  for (let frame = 0; frame < 45; frame++) {
    assert.equal(controller.update(world, "Bot", frame * 1000 / 60, 1 / 60).shoot, false);
  }
  const threatened = bankArena();
  threatened.tanks.Bot.angle = Math.PI / 2;
  threatened.bullets.incoming = { x: 35, y: 105, vx: 300, vy: 0,
    lifetime: 2, shooter: "Enemy", weapon_type: "default" };
  simulateDodge(threatened, 60, 0.25, (state, time, action) => assert.equal(action.shoot, false));
});
