import { tankCollides } from "./maze.js";
export function attemptMoveAndResolve(tank, dx, dy){ const ox=tank.x, oy=tank.y; tank.x+=dx; tank.y+=dy; if(tankCollides(tank)){ tank.x=ox; tank.y=oy; return false; } return true; }
export function attemptRotate(tank, dAngle){ const oa=tank.angle; tank.angle+=dAngle; if(!tankCollides(tank)) return true; tank.angle=oa; return false; }

