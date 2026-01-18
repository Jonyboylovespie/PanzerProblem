import { tankCollides } from "./maze.js";

function translateTank(tank, dx, dy) {
  // Apply a translation to a tank.
  tank.x += dx;
  tank.y += dy;
}

function revertTankPosition(tank, prevX, prevY) {
  // Revert tank position after a failed move.
  tank.x = prevX;
  tank.y = prevY;
}

function revertTankAngle(tank, prevAngle) {
  // Revert tank angle after a failed rotation.
  tank.angle = prevAngle;
}

export function attemptMoveAndResolve(tank, dx, dy) {
  // Attempt a move and revert if it collides with walls.
  const prevX = tank.x;
  const prevY = tank.y;

  translateTank(tank, dx, dy);

  if (!tankCollides(tank)) return true;

  revertTankPosition(tank, prevX, prevY);
  return false;
}

export function attemptRotate(tank, dAngle) {
  // Attempt a rotation and revert if it collides with walls.
  const prevAngle = tank.angle;
  tank.angle += dAngle;

  if (!tankCollides(tank)) return true;

  revertTankAngle(tank, prevAngle);
  return false;
}
