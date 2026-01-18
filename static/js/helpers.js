export function pointInRect(x, y, rect) {
  // Check if a point is inside an axis-aligned rectangle.
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}
export function pointInCircle(x, y, cx, cy, radius) {
  // Check if a point is inside (or on) a circle.
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}
