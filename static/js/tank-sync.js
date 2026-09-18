// Keep network traffic independent of the display's refresh rate.
export const TANK_UPDATE_INTERVAL_MS = 1000 / 30;
const TELEPORT_DISTANCE = 150;

export function createTankMoveSender(socket, identity) {
  let lastSentAt = -Infinity;
  let needsStop = false;

  return (tank, moving, nowMs) => {
    if (moving) needsStop = true;
    if (!socket.connected) return;
    if (!moving && !needsStop) return;
    if (moving && nowMs - lastSentAt < TANK_UPDATE_INTERVAL_MS) return;

    // Drop intermediate positions under backpressure; reliably send the final one.
    if (moving && !socket.io.engine.transport.writable) return;
    const transport = moving ? socket.volatile : socket;
    transport.emit("tank_move", {
      ...identity,
      x: tank.x,
      y: tank.y,
      angle: tank.angle,
      stopped: !moving,
    });
    lastSentAt = nowMs;
    needsStop = moving;
  };
}

export function mergeTankSnapshot(previous, incoming, playerName, reset = false) {
  const tanks = {};
  for (const [name, snapshot] of Object.entries(incoming)) {
    const tank = { ...snapshot };
    const old = previous[name];
    tanks[name] = tank;
    if (reset || !old || old.alive === false || tank.alive === false) continue;
    if (Math.hypot(tank.x - old.x, tank.y - old.y) >= TELEPORT_DISTANCE) continue;

    if (name === playerName) {
      // Movement is simulated locally; echoed positions are already out of date.
      tank.x = old.x;
      tank.y = old.y;
      tank.angle = old.angle;
    } else if (!tank.stopped) {
      // Repeated snapshots must not restart interpolation and add more delay.
      const target = old.motion;
      if (target && target.x === tank.x && target.y === tank.y && target.angle === tank.angle) {
        tank.motion = target;
      } else {
        tank.motion = {
          fromX: old.x, fromY: old.y, fromAngle: old.angle,
          x: tank.x, y: tank.y, angle: tank.angle, elapsed: 0,
        };
      }
      tank.x = old.x;
      tank.y = old.y;
      tank.angle = old.angle;
    }
  }
  return tanks;
}

export function interpolateRemoteTanks(tanks, playerName, deltaSeconds) {
  for (const [name, tank] of Object.entries(tanks)) {
    const motion = tank.motion;
    if (name === playerName || tank.alive === false || !motion) continue;
    motion.elapsed += deltaSeconds * 1000;
    const alpha = Math.min(1, motion.elapsed / TANK_UPDATE_INTERVAL_MS);
    const angleDelta = Math.atan2(
      Math.sin(motion.angle - motion.fromAngle),
      Math.cos(motion.angle - motion.fromAngle),
    );
    tank.x = motion.fromX + (motion.x - motion.fromX) * alpha;
    tank.y = motion.fromY + (motion.y - motion.fromY) * alpha;
    tank.angle = motion.fromAngle + angleDelta * alpha;
  }
}
