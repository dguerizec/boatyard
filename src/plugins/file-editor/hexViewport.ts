export const HEX_ROW_BYTES = 16;
export const HEX_ROW_HEIGHT = 28;
const MAX_SCROLL_HEIGHT = 8_000_000;

export function hexGeometry(size: number, height: number) {
  const rows = Math.ceil(size / HEX_ROW_BYTES);
  const visible = Math.max(1, Math.floor(height / HEX_ROW_HEIGHT));
  return { rows, visible, last: Math.max(0, rows - visible), height: Math.min(MAX_SCROLL_HEIGHT, Math.max(height, rows * HEX_ROW_HEIGHT)) };
}
export function hexRowAtScroll(size: number, height: number, top: number) {
  const geometry = hexGeometry(size, height);
  return Math.round(Math.max(0, Math.min(1, top / Math.max(1, geometry.height - height))) * geometry.last);
}
export function hexScrollAtRow(size: number, height: number, row: number) {
  const geometry = hexGeometry(size, height);
  return Math.max(0, Math.min(geometry.last, row)) / Math.max(1, geometry.last) * Math.max(0, geometry.height - height);
}
