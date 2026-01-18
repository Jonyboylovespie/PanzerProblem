function createInitialState() {
  // Create the initial client-side game state shape.
  return {
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
    wallRects: [],
  };
}

export const STATE = createInitialState();

function getTextContentById(id) {
  // Read an element's textContent, falling back to "".
  const el = document.getElementById(id);
  return el ? el.textContent || "" : "";
}

function readGameConfig() {
  // Read dataset values from the game config element.
  const el = document.getElementById("game-config");
  if (!el) return { hostName: "", started: false };
  return {
    hostName: el.dataset.host || "",
    started: el.dataset.started === "true",
  };
}

export function initStateFromDOM() {
  // Hydrate STATE from the DOM.
  STATE.gameCode = getTextContentById("game-code");
  STATE.playerName = getTextContentById("player-name");

  const { hostName, started } = readGameConfig();
  STATE.hostName = hostName;
  STATE.started = started;
  STATE.isHost = STATE.hostName === STATE.playerName;
}
