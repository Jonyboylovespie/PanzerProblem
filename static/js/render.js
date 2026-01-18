import { STATE } from "./state.js";

export let canvas = null;
export let ctx = null;

const WALL_COLOR = "#000";
const WALL_THICKNESS = 5;

const TANK_BODY = { w: 30, h: 20, x: -15, y: -10 };
const TANK_BARREL = { w: 20, h: 6, x: 0, y: -3 };
const LABEL = { color: "#000", font: "12px Arial", x: -10, y: -15 };

const BULLET = { radius: 4, color: "#000" };

export function initRender() {
  canvas = document.getElementById("game-canvas");
  ctx = canvas ? canvas.getContext("2d") : null;
}

function withContext(transformFn, drawFn) {
  // Save/restore canvas state around a transformed draw.
  if (!ctx) return;
  ctx.save();
  transformFn();
  drawFn();
  ctx.restore();
}

function configureWallsStyle() {
  // Apply consistent wall stroke configuration.
  if (!ctx) return;
  ctx.strokeStyle = WALL_COLOR;
  ctx.lineWidth = WALL_THICKNESS;
}

function drawWallSegment(seg) {
  // Draw a single wall segment.
  if (!ctx) return;
  ctx.beginPath();
  ctx.moveTo(seg.x1, seg.y1);
  ctx.lineTo(seg.x2, seg.y2);
  ctx.stroke();
}

export function drawMaze() {
  if (!ctx || !STATE.wallsReady) return;
  configureWallsStyle();
  for (const seg of STATE.wallSegments) drawWallSegment(seg);
}

export function drawTank(x, y, angle, color, name) {
  if (!ctx) return;

  withContext(
    () => {
      ctx.translate(x, y);
      ctx.rotate(angle);
    },
    () => {
      ctx.fillStyle = color;
      ctx.fillRect(TANK_BODY.x, TANK_BODY.y, TANK_BODY.w, TANK_BODY.h);
      ctx.fillRect(TANK_BARREL.x, TANK_BARREL.y, TANK_BARREL.w, TANK_BARREL.h);
    },
  );

  drawTankLabel(x, y, name);
}

function drawTankLabel(x, y, name) {
  // Draw player label above the tank.
  if (!ctx) return;
  ctx.fillStyle = LABEL.color;
  ctx.font = LABEL.font;
  ctx.fillText(name, x + LABEL.x, y + LABEL.y);
}

export function drawBullet(x, y) {
  if (!ctx) return;
  ctx.fillStyle = BULLET.color;
  ctx.beginPath();
  ctx.arc(x, y, BULLET.radius, 0, 2 * Math.PI);
  ctx.fill();
}
