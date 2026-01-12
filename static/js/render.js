import { STATE } from "./state.js";
export let canvas = null;
export let ctx = null;

export function initRender() {
  canvas = document.getElementById("game-canvas");
  ctx = canvas ? canvas.getContext("2d") : null;
}

export function drawTank(x, y, angle, color, name) {
  if (!ctx) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = color; ctx.fillRect(-15, -10, 30, 20); ctx.fillRect(0, -3, 20, 6);
  ctx.rotate(-angle); ctx.fillStyle = "#000"; ctx.font = "12px Arial"; ctx.fillText(name, -10, -15);
  ctx.restore();
}
export function drawBullet(x, y) { if (!ctx) return; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x, y, 4, 0, 2*Math.PI); ctx.fill(); }
export function drawMaze() {
  if (!ctx || !STATE.wallsReady) return;
  ctx.strokeStyle = "#000"; ctx.lineWidth = 5;
  for (const seg of STATE.wallSegments) { ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke(); }
}
