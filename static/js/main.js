import { STATE, initStateFromDOM } from "./state.js";
import { initInput, keys } from "./input.js";
import { attemptMoveAndResolve, attemptRotate } from "./movement.js";
import { createBulletManager } from "./bullets.js";
import { drawMaze, drawTank, initRender, ctx } from "./render.js";
import { initSocket, updatePlayersList } from "./socket.js";

const MOVE_SPEED_PIXELS_PER_SEC = 150;
const ROT_SPEED_RAD_PER_SEC = 4;
const BACKWARD_SPEED_MULTIPLIER = 0.5;
const FPS_SMOOTHING = 0.9;

let socket = null;
let bulletManager = null;

function emitTankMove(tank) {
  // Emit the local player's tank state.
  socket.emit("tank_move", {
    game_code: STATE.gameCode,
    player_name: STATE.playerName,
    x: tank.x,
    y: tank.y,
    angle: tank.angle,
  });
}

function clearCanvas() {
  // Clear the frame.
  if (!ctx) return;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function updateFpsCounter(fpsEl, fpsState, deltaSeconds) {
  // Update smoothed FPS counter.
  const instantFps = deltaSeconds > 0 ? 1 / deltaSeconds : 0;
  fpsState.value =
    fpsState.value === 0
      ? instantFps
      : fpsState.value * FPS_SMOOTHING + instantFps * (1 - FPS_SMOOTHING);

  if (fpsEl) fpsEl.textContent = "FPS: " + Math.round(fpsState.value);
}

function getMovementDelta(tank, deltaSeconds) {
  // Compute desired dx/dy based on current input.
  const forward = keys.w || keys.ArrowUp;
  const backward = keys.s || keys.ArrowDown;

  if (!forward && !backward) return { dx: 0, dy: 0 };

  const speed =
    MOVE_SPEED_PIXELS_PER_SEC *
    deltaSeconds *
    (backward ? BACKWARD_SPEED_MULTIPLIER : 1);

  const dir = backward ? -1 : 1;
  return {
    dx: Math.cos(tank.angle) * speed * dir,
    dy: Math.sin(tank.angle) * speed * dir,
  };
}

function applyMovement(tank, deltaSeconds) {
  // Apply move/rotate attempts and return whether anything changed.
  let moved = false;

  const { dx, dy } = getMovementDelta(tank, deltaSeconds);
  if (dx !== 0 || dy !== 0)
    moved = attemptMoveAndResolve(tank, dx, dy) || moved;

  const rotLeft = keys.a || keys.ArrowLeft;
  const rotRight = keys.d || keys.ArrowRight;
  const rotDelta = ROT_SPEED_RAD_PER_SEC * deltaSeconds;

  if (rotLeft) moved = attemptRotate(tank, -rotDelta) || moved;
  if (rotRight) moved = attemptRotate(tank, rotDelta) || moved;

  return moved;
}

function handleShooting() {
  // Fire once per keypress when the game is started.
  if (!STATE.started) return;
  if (!keys[" "]) return;

  if (!bulletManager.hasActiveFor(STATE.playerName)) {
    bulletManager.spawnFromTank(STATE.playerName);
  }

  keys[" "] = false;
}

function renderTanks() {
  // Render every tank.
  for (const [name, tank] of Object.entries(STATE.tanks)) {
    drawTank(tank.x, tank.y, tank.angle, tank.color, name);
  }
}

function attachStartButtonIfHost() {
  // Attach host-only start handler.
  const startBtn = document.getElementById("start-button");
  if (!startBtn || !STATE.isHost) return;

  startBtn.addEventListener("click", () => {
    socket.emit("start_game", {
      game_code: STATE.gameCode,
      player_name: STATE.playerName,
    });
  });
}

function attachLeaveButton() {
  // Return to the home page.
  const leaveBtn = document.getElementById("leave-button");
  if (!leaveBtn) return;

  leaveBtn.addEventListener("click", () => {
    window.location.href = "/";
  });
}

function startGame() {
  initStateFromDOM();
  updatePlayersList();
  initRender();
  initInput();

  socket = initSocket();
  bulletManager = createBulletManager(socket);

  attachStartButtonIfHost();
  attachLeaveButton();

  const fpsEl = document.getElementById("fps-counter");
  const fpsState = { value: 0 };
  let previousMs = Date.now();

  function loop() {
    const nowMs = Date.now();
    const deltaSeconds = (nowMs - previousMs) / 1000.0;
    previousMs = nowMs;

    updateFpsCounter(fpsEl, fpsState, deltaSeconds);
    clearCanvas();
    drawMaze();

    const me = STATE.tanks[STATE.playerName];
    if (me) {
      const moved = applyMovement(me, deltaSeconds);
      if (moved) emitTankMove(me);
      handleShooting();
    }

    bulletManager.update(deltaSeconds);
    bulletManager.render();
    renderTanks();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

document.addEventListener("DOMContentLoaded", startGame);
