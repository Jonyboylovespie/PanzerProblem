import { STATE } from './state.js';
import { rebuildWalls } from './maze.js';
import { canvas } from './render.js';
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
  socket.on('player_left', (data)=>{ STATE.tanks=data.game_data.tanks||{}; });
  socket.on('player_join', (data)=>{ STATE.tanks=data.game_data.tanks||{}; });
  return socket;
}
