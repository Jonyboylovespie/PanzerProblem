import { STATE } from "./state.js";
import { rebuildWalls } from "./maze.js";
import { canvas } from "./render.js";

const MIN_PLAYERS_TO_START = 2;

function getPlayerNames() {
  // Prefer authoritative player list when present; fallback to tank keys.
  if (Array.isArray(STATE.players) && STATE.players.length)
    return STATE.players;
  return Object.keys(STATE.tanks || {});
}

function getPlayerCount() {
  // Count players in a consistent way for UI gating.
  return getPlayerNames().length;
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
  STATE.tanks = tanks || {};
}

function updateStartButton() {
  // Keep start button consistent with current state.
  const button = document.getElementById("start-button");
  if (!button) return;

  const canStart =
    STATE.isHost && !STATE.started && getPlayerCount() >= MIN_PLAYERS_TO_START;

  button.disabled = !canStart;
}

export function updatePlayersList() {
  // Render the players UI list with host + score.
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
    li.textContent = `${name}${hostSuffix} - Score: ${score}`;
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

  if (canvas && STATE.maze && STATE.maze.length) {
    canvas.width = STATE.maze[0].length * STATE.cellSize;
    canvas.height = STATE.maze.length * STATE.cellSize;
  }

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
    STATE.bullets = bulletsData || {};
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
