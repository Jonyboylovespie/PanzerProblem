import { STATE } from './state.js';
import { rebuildWalls } from './maze.js';
import { canvas } from './render.js';

function updateStartButton(){
  const btn = document.getElementById('start-button');
  if (!btn) return;
  // Host can only start when at least 2 players and not already started
  const playerCount = (STATE && STATE.tanks) ? Object.keys(STATE.tanks).length : 0;
  btn.disabled = !STATE.isHost || STATE.started || playerCount < 2;
}

function updatePlayersList(){
  const listEl = document.getElementById('players-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const players = STATE.players && STATE.players.length ? STATE.players : Object.keys(STATE.tanks || {});
  for (const name of players) {
    const li = document.createElement('li');
    const score = (STATE.scores && typeof STATE.scores[name] !== 'undefined') ? STATE.scores[name] : 0;
    let text = name;
    if (name === STATE.hostName) text += ' (Host)';
    text += ` - Score: ${score}`;
    li.textContent = text;
    listEl.appendChild(li);
  }
}

function applyGameData(gameData){
  if (!gameData) return;
  if (gameData.tanks) {
    STATE.tanks = gameData.tanks || {};
  }
  if (Array.isArray(gameData.players)) {
    STATE.players = gameData.players.slice();
  }
  if (gameData.scores) {
    STATE.scores = gameData.scores || {};
  }
  if (gameData.host) {
    STATE.hostName = gameData.host;
    STATE.isHost = (STATE.hostName === STATE.playerName);
  }
  if (typeof gameData.started === 'boolean') {
    STATE.started = gameData.started;
  }
  updatePlayersList();
  updateStartButton();
}

export function initSocket(){
  const socket = io();
  socket.emit('join', { game_code: STATE.gameCode, player_name: STATE.playerName });
  socket.emit('request_maze', { game_code: STATE.gameCode });
  socket.on('maze_data', (data)=>{
    STATE.maze=data.maze; STATE.cellSize=data.cell_size;
    if (canvas) { canvas.width=STATE.maze[0].length*STATE.cellSize; canvas.height=STATE.maze.length*STATE.cellSize; }
    rebuildWalls();
  });
  socket.on('update_tanks', (tanksData)=>{ STATE.tanks=tanksData||{}; });
  socket.on('update_bullets', (bulletsData)=>{ STATE.bullets=bulletsData||{}; });
  socket.on('player_left', (data)=>{ applyGameData(data.game_data); });
  socket.on('player_join', (data)=>{ applyGameData(data.game_data); });
  socket.on('game_started', (data)=>{
    if (data && typeof data.started === 'boolean') {
      STATE.started = data.started;
    }
    updateStartButton();
  });
  return socket;
}
