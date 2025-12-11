import { STATE, initStateFromDOM } from './state.js';
import { keys, initInput } from './input.js';
import { drawMaze, drawTank, ctx, initRender } from './render.js';
import { attemptMoveAndResolve, attemptRotate } from './movement.js';
import { initSocket } from './socket.js';
import { createBulletManager } from './bullets.js';

let socket = null;
let BulletManager = null;
let timePreviousLoop = 0;
let fpsSmoothed = 0;

function startGame(){
  initStateFromDOM();
  initRender();
  initInput();
  socket = initSocket();
  BulletManager = createBulletManager(socket);

  // Host can start the real game from the lobby
  const startBtn = document.getElementById('start-button');
  if (startBtn && STATE.isHost) {
    startBtn.addEventListener('click', ()=>{
      socket.emit('start_game', { game_code: STATE.gameCode, player_name: STATE.playerName });
    });
  }

  timePreviousLoop = Date.now();
  const fpsEl = document.getElementById('fps-counter');

  function loop(){
    const now=Date.now(); const delta=(now-timePreviousLoop)/1000.0; timePreviousLoop=now;
    const instFPS = delta>0 ? (1/delta) : 0; fpsSmoothed = fpsSmoothed ? (fpsSmoothed*0.9 + instFPS*0.1) : instFPS; if (fpsEl) fpsEl.textContent = 'FPS: ' + Math.round(fpsSmoothed);
    if (ctx) { ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height); }
    drawMaze();

    const me=STATE.tanks[STATE.playerName];
    if(me){
      const moveSpeed=150*delta, rotSpeed=4*delta; let dx=0, dy=0;
      if(keys.w || keys.ArrowUp){ dx+=Math.cos(me.angle)*moveSpeed; dy+=Math.sin(me.angle)*moveSpeed; }
      if(keys.s || keys.ArrowDown){ dx-=Math.cos(me.angle)*(moveSpeed/2); dy-=Math.sin(me.angle)*(moveSpeed/2); }
      let moved=false; if(dx!==0||dy!==0){ if(attemptMoveAndResolve(me,dx,dy)) moved=true; }
      if(keys.a || keys.ArrowLeft){ if(attemptRotate(me,-rotSpeed)) moved=true; }
      if(keys.d || keys.ArrowRight){ if(attemptRotate(me,rotSpeed)) moved=true; }
      if(moved){ socket.emit('tank_move',{ game_code: STATE.gameCode, player_name: STATE.playerName, x: me.x, y: me.y, angle: me.angle }); }
      // No shooting until the game has started
      if(STATE.started && keys[' ']){ if(!BulletManager.hasActiveFor(STATE.playerName)) BulletManager.spawnFromTank(STATE.playerName); keys[' ']=false; }
    }

    BulletManager.update(delta);
    BulletManager.render();

    for(const [name,t] of Object.entries(STATE.tanks)) drawTank(t.x,t.y,t.angle,t.color,name);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

document.addEventListener('DOMContentLoaded', startGame);

// Leave button
document.getElementById('leave-button').addEventListener('click', ()=>{ window.location.href='/'; });
