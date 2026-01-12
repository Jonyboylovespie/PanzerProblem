export const STATE = {
  gameCode: "",
  playerName: "",
  hostName: "",
  isHost: false,
  started: false,
  players: [],
  scores: {},
  tanks: {},
  bullets: {},
  maze: [],
  cellSize: 0,
  wallsReady: false,
  wallSegments: [],
  wallRects: []
};

export function initStateFromDOM() {
  const gameCodeEl = document.getElementById("game-code");
  const playerNameEl = document.getElementById("player-name");
  const configEl = document.getElementById("game-config");
  STATE.gameCode = gameCodeEl ? gameCodeEl.textContent : "";
  STATE.playerName = playerNameEl ? playerNameEl.textContent : "";
  if (configEl) {
    STATE.hostName = configEl.dataset.host || "";
    STATE.isHost = (STATE.hostName === STATE.playerName);
    STATE.started = (configEl.dataset.started === "true");
  }
}
