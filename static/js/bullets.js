import { STATE } from "./state.js";
import { pointInCircle } from "./helpers.js";
import { stepBullet } from "./bullet-physics.js";
import { drawBullet, drawLaserTrail, ctx } from "./render.js";

const HIT_RADIUS = 15;

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

function findVictimAt(x, y) {
  // Find the first alive tank hit at a point.
  for (const [name, tank] of Object.entries(STATE.tanks)) {
    if (!shouldConsiderVictim(name, tank)) continue;
    if (pointInCircle(x, y, tank.x, tank.y, HIT_RADIUS)) return name;
  }
  return null;
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
  // Allow the server to manage weapon limits and state authority.
  return false;
}

function requestSpawnBullet(socket, shooterName) {
  // Ask server to spawn a bullet; include coordinates for Frag detonation.
  const data = { game_code: STATE.gameCode, player_name: shooterName };
  const tank = STATE.tanks[shooterName];

  if (tank && tank.weapon === "frag") {
    const frag = Object.values(STATE.bullets).find(
      (b) => b.shooter === shooterName && b.weapon_type === "frag",
    );
    if (frag) {
      data.frag_x = frag.x;
      data.frag_y = frag.y;
    }
  }
  socket.emit("shoot", data);
}

function updateAllBullets(socket, deltaSeconds) {
  // Update all bullets locally with sub-stepping for high speeds.
  const toRemove = [];
  const localToRemove = [];
  const MAX_STEP_DIST = 5;

  for (const [id, bullet] of Object.entries(STATE.bullets)) {
    const isOwner = bullet.shooter === STATE.playerName;
    if (tickLifetime(bullet, deltaSeconds)) {
      if (isOwner) toRemove.push(id);
      else localToRemove.push(id);
      continue;
    }

    const speed = Math.hypot(bullet.vx, bullet.vy);
    const totalDist = speed * deltaSeconds;
    const numSubSteps =
      totalDist > 0 ? Math.ceil(totalDist / MAX_STEP_DIST) : 1;
    const subDelta = deltaSeconds / numSubSteps;
    let dead = false;

    if (bullet.weapon_type === "laser" && !bullet.trail) {
      bullet.trail = [{ x: bullet.x, y: bullet.y }];
    }

    for (let s = 0; s < numSubSteps; s++) {
      const { nextX, nextY, hitWall } = stepBullet(bullet, subDelta, STATE.wallRects);
      if (hitWall) {
        if (isOwner) toRemove.push(id);
        else localToRemove.push(id);
        dead = true;
        break;
      }
      const victim = findVictimAt(nextX, nextY);
      if (victim) {
        if (isOwner) {
          toRemove.push(id);
          emitBulletHit(socket, id, victim);
        } else localToRemove.push(id);
        dead = true;
        break;
      }
      bullet.x = nextX;
      bullet.y = nextY;
      if (bullet.weapon_type === "laser")
        bullet.trail.push({ x: nextX, y: nextY });
    }
    if (dead) continue;
  }

  removeBullets(socket, toRemove);
  for (const id of localToRemove) removeBulletLocal(id);
}

function renderAllBullets() {
  // Render all bullets from state, using triangles for fragments.
  for (const bullet of Object.values(STATE.bullets)) {
    if (bullet.weapon_type === "laser" && bullet.trail) {
      drawLaserTrail(bullet.trail);
    }

    if (bullet.weapon_type === "fragment") {
      drawFragment(bullet.x, bullet.y, bullet.vx, bullet.vy);
    } else {
      drawBullet(bullet.x, bullet.y, bullet.weapon_type);
    }
  }
}

function drawFragment(x, y, vx, vy) {
  // Draw a small triangular fragment pointing in velocity direction.
  if (!ctx) return;
  const angle = Math.atan2(vy, vx);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#FFD700";
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(-2, -2);
  ctx.lineTo(-2, 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.restore();
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
