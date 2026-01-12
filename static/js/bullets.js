import { STATE } from "./state.js";
import { pointInRect, pointInCircle } from "./helpers.js";
import { drawBullet } from "./render.js";
export function createBulletManager(socket){
  const radiusHit = 15;
  return {
    hasActiveFor(name){ return Object.values(STATE.bullets).some(b => b.shooter === name); },
    spawnFromTank(name){ socket.emit("shoot", { game_code: STATE.gameCode, player_name: name }); },
    update(delta){
      const toRemove=[];
      for(const [id,b] of Object.entries(STATE.bullets)){
        b.lifetime -= delta; if(b.lifetime<=0){ toRemove.push(id); continue; }
        const origSpeed = Math.hypot(b.vx,b.vy)||0;
        let nx=b.x+b.vx*delta, ny=b.y+b.vy*delta;
        let hitX=false, hitY=false;
        for(const r of STATE.wallRects){ if(pointInRect(nx,b.y,r)){ hitX=true; break; } }
        if(hitX){ b.vx=-b.vx; nx=b.x+b.vx*delta; }
        for(const r of STATE.wallRects){ if(pointInRect(b.x,ny,r)){ hitY=true; break; } }
        if(hitY){ b.vy=-b.vy; ny=b.y+b.vy*delta; }
        const mag=Math.hypot(b.vx,b.vy); if(mag>0 && Math.abs(mag-origSpeed)>1e-6){ b.vx*=origSpeed/mag; b.vy*=origSpeed/mag; }
        let victim=null; for(const [name,t] of Object.entries(STATE.tanks)){ if(pointInCircle(nx,ny,t.x,t.y,radiusHit)){ victim=name; break; } }
        if(victim){ toRemove.push(id); socket.emit("bullet_hit_tank",{ game_code: STATE.gameCode, bullet_id:id, victim_name:victim }); }
        else { b.x=nx; b.y=ny; socket.emit("bullet_state",{ game_code: STATE.gameCode, bullet_id:id, bullet:b }); }
      }
      for(const id of toRemove){ delete STATE.bullets[id]; socket.emit("bullet_remove",{ game_code: STATE.gameCode, bullet_id:id }); }
    },
    render(){ for(const b of Object.values(STATE.bullets)) drawBullet(b.x,b.y); }
  };
}

