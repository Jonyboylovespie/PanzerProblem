export function pointInRect(x, y, rect) { return (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h); }
export function pointInCircle(x, y, cx, cy, radius) { const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= radius * radius; }

