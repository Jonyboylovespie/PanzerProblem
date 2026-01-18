import { STATE } from "./state.js";
import { pointInCircle, pointInRect } from "./helpers.js";
import { drawBullet } from "./render.js";

const HIT_RADIUS = 15;
const SPEED_EPSILON = 1e-6;

function isTankAlive(tank) {
  // Treat missing flag as alive for backward compatibility.
  if (!tank) return false;
  if (typeof tank.alive === "boolean") return tank.alive;
  return true;
}

function shouldConsiderVictim(name, tank) {
  // Ignore dead/inactive tanks and missing tanks.
  if (!name || !tank) return false;
  return isTankAlive(tank);
}

function emitBulletRemove(socket, bulletId) {
  // Notify server bullet should be removed.
  socket.emit("bullet_remove", {
    game_code: STATE.gameCode,
    bullet_id: bulletId,
  });
}

function emitBulletState(socket, bulletId, bullet) {
  // Send client-authoritative bullet state to server.
  socket.emit("bullet_state", {
    game_code: STATE.gameCode,
    bullet_id: bulletId,
    bullet,
  });
}

function emitBulletHit(socket, bulletId, victimName) {
  // Notify server a bullet hit a tank.
  socket.emit("bullet_hit_tank", {
    game_code: STATE.gameCode,
    bullet_id: bulletId,
    victim_name: victimName,
  });
}

function willHitWallAtX(nextX, currentY) {
  // Check collision against wall rects at proposed X.
  for (const rect of STATE.wallRects) {
    if (pointInRect(nextX, currentY, rect)) return true;
  }
  return false;
}

function willHitWallAtY(currentX, nextY) {
  // Check collision against wall rects at proposed Y.
  for (const rect of STATE.wallRects) {
    if (pointInRect(currentX, nextY, rect)) return true;
  }
  return false;
}

function normalizeVelocityToSpeed(bullet, targetSpeed) {
  // Keep bullet speed constant after bounces.
  const currentSpeed = Math.hypot(bullet.vx, bullet.vy);
  if (!currentSpeed) return;

  if (Math.abs(currentSpeed - targetSpeed) <= SPEED_EPSILON) return;

  const scale = targetSpeed / currentSpeed;
  bullet.vx *= scale;
  bullet.vy *= scale;
}

function findVictimAt(x, y) {
  // Find the first alive tank hit at a point.
  for (const [name, tank] of Object.entries(STATE.tanks)) {
    if (!shouldConsiderVictim(name, tank)) continue;
    if (pointInCircle(x, y, tank.x, tank.y, HIT_RADIUS)) return name;
  }
  return null;
}

function stepBullet(bullet, deltaSeconds) {
  // Advance a bullet and bounce it off walls.
  const originalSpeed = Math.hypot(bullet.vx, bullet.vy) || 0;

  let nextX = bullet.x + bullet.vx * deltaSeconds;
  let nextY = bullet.y + bullet.vy * deltaSeconds;

  if (willHitWallAtX(nextX, bullet.y)) {
    bullet.vx = -bullet.vx;
    nextX = bullet.x + bullet.vx * deltaSeconds;
  }

  if (willHitWallAtY(bullet.x, nextY)) {
    bullet.vy = -bullet.vy;
    nextY = bullet.y + bullet.vy * deltaSeconds;
  }

  if (originalSpeed > 0) normalizeVelocityToSpeed(bullet, originalSpeed);

  return { nextX, nextY };
}

function tickLifetime(bullet, deltaSeconds) {
  // Decrease lifetime; return true when expired.
  bullet.lifetime -= deltaSeconds;
  return bullet.lifetime <= 0;
}

function removeBulletLocal(bulletId) {
  // Remove from local state.
  delete STATE.bullets[bulletId];
}

function removeBullets(socket, bulletIds) {
  // Remove bullets locally and notify server.
  for (const id of bulletIds) {
    removeBulletLocal(id);
    emitBulletRemove(socket, id);
  }
}

function hasActiveBulletFor(shooterName) {
  // Enforce one bullet per shooter.
  return Object.values(STATE.bullets).some((b) => b.shooter === shooterName);
}

function requestSpawnBullet(socket, shooterName) {
  // Ask server to spawn a bullet for shooter.
  socket.emit("shoot", { game_code: STATE.gameCode, player_name: shooterName });
}

function updateAllBullets(socket, deltaSeconds) {
  // Update bullets, handle wall bounces, hits, and expirations.
  const toRemove = [];

  for (const [id, bullet] of Object.entries(STATE.bullets)) {
    if (tickLifetime(bullet, deltaSeconds)) {
      toRemove.push(id);
      continue;
    }

    const { nextX, nextY } = stepBullet(bullet, deltaSeconds);
    const victim = findVictimAt(nextX, nextY);

    if (victim) {
      toRemove.push(id);
      emitBulletHit(socket, id, victim);
      continue;
    }

    bullet.x = nextX;
    bullet.y = nextY;
    emitBulletState(socket, id, bullet);
  }

  removeBullets(socket, toRemove);
}

function renderAllBullets() {
  // Render all bullets from state.
  for (const bullet of Object.values(STATE.bullets)) {
    drawBullet(bullet.x, bullet.y);
  }
}

export function createBulletManager(socket) {
  // Create a bullet manager tied to socket + global state.
  return {
    hasActiveFor(name) {
      return hasActiveBulletFor(name);
    },
    spawnFromTank(name) {
      requestSpawnBullet(socket, name);
    },
    update(deltaSeconds) {
      updateAllBullets(socket, deltaSeconds);
    },
    render() {
      renderAllBullets();
    },
  };
}
