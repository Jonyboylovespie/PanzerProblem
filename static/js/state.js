export const STATE = {
  gameCode: '',
  playerName: '',
  tanks: {},
  bullets: {},
  maze: [],
  cellSize: 0,
  wallsReady: false,
  wallSegments: [],
  wallRects: []
};

export function initStateFromDOM() {
  const gameCodeEl = document.getElementById('game-code');
  const playerNameEl = document.getElementById('player-name');
  STATE.gameCode = gameCodeEl ? gameCodeEl.textContent : '';
  STATE.playerName = playerNameEl ? playerNameEl.textContent : '';
}
