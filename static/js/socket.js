import { STATE } from "./state.js";
import { rebuildWalls } from "./maze.js";
import { canvas } from "./render.js";

const MIN_PLAYERS_TO_START = 2;

function clampPositiveInt(value, fallback) {
  // Clamp to a positive integer fallback.
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

function getCanvasExtraCssPixels() {
  // Read canvas CSS border/padding to avoid fitting slightly too large.
  if (!canvas) return { w: 0, h: 0 };

  const style = window.getComputedStyle(canvas);
  const px = (v) => {
    const n = parseFloat(v || "0");
    return Number.isFinite(n) ? n : 0;
  };

  const bw = px(style.borderLeftWidth) + px(style.borderRightWidth);
  const bh = px(style.borderTopWidth) + px(style.borderBottomWidth);
  const pw = px(style.paddingLeft) + px(style.paddingRight);
  const ph = px(style.paddingTop) + px(style.paddingBottom);

  return { w: bw + pw, h: bh + ph };
}

function getViewportSize() {
  // Read the current viewport size in CSS pixels.
  const w = window.innerWidth || document.documentElement.clientWidth || 0;
  const h = window.innerHeight || document.documentElement.clientHeight || 0;
  return { w, h };
}

function getGameContainerSize() {
  // Measure the container to size the canvas to, falling back to viewport.
  const container = document.getElementById("game-container");
  const rect = container ? container.getBoundingClientRect() : null;
  const w = rect ? rect.width : 0;
  const h = rect ? rect.height : 0;

  const viewport = getViewportSize();
  return {
    w: w > 0 ? w : viewport.w,
    h: h > 0 ? h : viewport.h,
  };
}

function getFullscreenElement() {
  // Return the current fullscreen element across vendors.
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function requestFullscreen(el) {
  // Enter fullscreen across vendors where available.
  if (!el) return;
  const fn =
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.mozRequestFullScreen ||
    el.msRequestFullscreen;
  if (typeof fn === "function") fn.call(el);
}

function exitFullscreen() {
  // Exit fullscreen across vendors where available.
  const fn =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.mozCancelFullScreen ||
    document.msExitFullscreen;
  if (typeof fn === "function") fn.call(document);
}

function toggleFullscreen(targetEl) {
  // Toggle fullscreen for the given element (or current fullscreen state).
  if (getFullscreenElement()) exitFullscreen();
  else requestFullscreen(targetEl);
}

function calculateCanvasPixelSizeForMaze() {
  // Compute the maze's unscaled pixel size.
  if (!STATE.maze || !STATE.maze.length) return { w: 0, h: 0 };
  const mazeW = STATE.maze[0].length;
  const mazeH = STATE.maze.length;
  return { w: mazeW * STATE.cellSize, h: mazeH * STATE.cellSize };
}

function fitCanvasToDisplayForMaze() {
  // Resize canvas to fill available area via CSS while keeping internal pixel grid.
  if (!canvas || !STATE.maze || !STATE.maze.length) return;

  const dpr = window.devicePixelRatio || 1;
  const css = getGameContainerSize();

  const extras = getCanvasExtraCssPixels();
  const availableCssW = Math.max(1, Math.floor(css.w - extras.w));
  const availableCssH = Math.max(1, Math.floor(css.h - extras.h));

  const mazePx = calculateCanvasPixelSizeForMaze();
  if (!mazePx.w || !mazePx.h) return;

  const scale = Math.min(availableCssW / mazePx.w, availableCssH / mazePx.h);
  const cssW = Math.max(1, Math.floor(mazePx.w * scale));
  const cssH = Math.max(1, Math.floor(mazePx.h * scale));

  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";

  const bufferW = clampPositiveInt(Math.floor(cssW * dpr), 1);
  const bufferH = clampPositiveInt(Math.floor(cssH * dpr), 1);

  canvas.width = bufferW;
  canvas.height = bufferH;

  const ctx = canvas.getContext("2d");
  const safeScaleX = bufferW / dpr / mazePx.w;
  const safeScaleY = bufferH / dpr / mazePx.h;
  const safeScale = Math.min(safeScaleX, safeScaleY);

  if (ctx) ctx.setTransform(dpr * safeScale, 0, 0, dpr * safeScale, 0, 0);
}

function attachFullscreenSupportOnce() {
  // Add a fullscreen toggle button and keep canvas fit synced with fullscreen.
  if (document.getElementById("fullscreen-button")) return;

  const container = document.getElementById("game-container");
  if (!container) return;

  const btn = document.createElement("button");
  btn.id = "fullscreen-button";
  btn.type = "button";
  btn.textContent = "Fullscreen";

  btn.addEventListener("click", () => {
    toggleFullscreen(container);
  });

  container.insertAdjacentElement("beforebegin", btn);

  const onFullscreenChange = () => {
    const fs = !!getFullscreenElement();
    btn.textContent = fs ? "Exit Fullscreen" : "Fullscreen";
    fitCanvasToDisplayForMaze();
  };

  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  document.addEventListener("mozfullscreenchange", onFullscreenChange);
  document.addEventListener("MSFullscreenChange", onFullscreenChange);

  window.addEventListener("resize", () => fitCanvasToDisplayForMaze());
  window.addEventListener("orientationchange", () =>
    fitCanvasToDisplayForMaze(),
  );
}

function isAlivePlayer(name) {
  // Determine if a player should be considered alive.
  const tank = STATE.tanks ? STATE.tanks[name] : null;
  if (!tank) return false;
  if (typeof tank.alive === "boolean") return tank.alive;
  return true;
}

function getPlayerNames() {
  // Prefer authoritative player list when present; fallback to tank keys.
  if (Array.isArray(STATE.players) && STATE.players.length)
    return STATE.players;
  return Object.keys(STATE.tanks || {});
}

function getAlivePlayerNames() {
  // Return only players that are currently alive.
  return getPlayerNames().filter((name) => isAlivePlayer(name));
}

function getAlivePlayerCount() {
  // Count alive players for UI gating.
  return getAlivePlayerNames().length;
}

function isStartedFlag(value) {
  // Normalize started field sent from server.
  return typeof value === "boolean" ? value : STATE.started;
}

function applyHost(hostName) {
  // Update host/isHost derived fields.
  if (!hostName) return;
  STATE.hostName = hostName;
  STATE.isHost = STATE.hostName === STATE.playerName;
}

function applyPlayers(players) {
  // Replace player list if server provides it.
  if (!Array.isArray(players)) return;
  STATE.players = players.slice();
}

function applyScores(scores) {
  // Replace scores dict if server provides it.
  if (!scores) return;
  STATE.scores = scores || {};
}

function applyTanks(tanks) {
  // Replace tanks dict if server provides it.
  if (!tanks) return;
  const myTank = STATE.tanks ? STATE.tanks[STATE.playerName] : null;
  STATE.tanks = tanks || {};
  if (myTank && STATE.tanks[STATE.playerName]) {
    if (myTank.alive && STATE.tanks[STATE.playerName].alive) {
      const serverTank = STATE.tanks[STATE.playerName];
      const dist = Math.hypot(serverTank.x - myTank.x, serverTank.y - myTank.y);
      if (dist < 150) {
        serverTank.x = myTank.x;
        serverTank.y = myTank.y;
        serverTank.angle = myTank.angle;
      }
    }
  }
}

function updateStartButton() {
  // Keep start button consistent with current state.
  const button = document.getElementById("start-button");
  if (!button) return;

  const canStart =
    STATE.isHost &&
    !STATE.started &&
    getPlayerNames().length >= MIN_PLAYERS_TO_START;

  button.disabled = !canStart;
}

export function updatePlayersList() {
  // Render the players UI list with host + score + dead status.
  const listEl = document.getElementById("players-list");
  if (!listEl) return;

  listEl.innerHTML = "";
  for (const name of getPlayerNames()) {
    const li = document.createElement("li");
    const score =
      STATE.scores && typeof STATE.scores[name] !== "undefined"
        ? STATE.scores[name]
        : 0;

    const hostSuffix = name === STATE.hostName ? " (Host)" : "";
    const aliveSuffix = isAlivePlayer(name) ? "" : " (Dead)";
    li.textContent = `${name}${hostSuffix}${aliveSuffix} - Score: ${score}`;
    listEl.appendChild(li);
  }
}

function applyGameData(gameData) {
  // Apply a server "game_data" snapshot onto STATE.
  if (!gameData) return;

  applyTanks(gameData.tanks);
  applyPlayers(gameData.players);
  applyScores(gameData.scores);
  applyHost(gameData.host);

  STATE.started = isStartedFlag(gameData.started);

  updatePlayersList();
  updateStartButton();
}

function applyMazeData(data) {
  // Apply maze payload and rebuild collision geometry.
  if (!data) return;

  STATE.maze = data.maze;
  STATE.cellSize = data.cell_size;

  attachFullscreenSupportOnce();
  fitCanvasToDisplayForMaze();
  rebuildWalls();
}

function bindCoreEvents(socket) {
  // Bind socket listeners that update STATE.
  socket.on("maze_data", applyMazeData);

  socket.on("update_tanks", (tanksData) => {
    applyTanks(tanksData);
    updatePlayersList();
    updateStartButton();
  });

  socket.on("update_bullets", (bulletsData) => {
    // Merge server updates into local state to prevent snapping and preserve local simulation.
    const incoming = bulletsData || {};
    for (const id in incoming) {
      if (!STATE.bullets[id]) {
        STATE.bullets[id] = incoming[id];
      }
    }
    for (const id in STATE.bullets) {
      if (!incoming[id]) {
        delete STATE.bullets[id];
      }
    }
  });

  socket.on("update_pickups", (pickups) => {
    STATE.pickups = pickups || [];
  });

  socket.on("update_scores", (scores) => {
    applyScores(scores);
    updatePlayersList();
  });

  socket.on("player_left", (data) => applyGameData(data && data.game_data));
  socket.on("player_join", (data) => applyGameData(data && data.game_data));

  socket.on("game_started", (data) => {
    STATE.started =
      data && typeof data.started === "boolean" ? data.started : STATE.started;
    updateStartButton();
  });
}

export function initSocket() {
  // Create and initialize the Socket.IO connection for the game room.
  const socket = io();

  socket.emit("join", {
    game_code: STATE.gameCode,
    player_name: STATE.playerName,
  });

  socket.emit("request_maze", { game_code: STATE.gameCode });

  bindCoreEvents(socket);

  return socket;
}
