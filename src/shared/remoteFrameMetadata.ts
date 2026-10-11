// A small transport-only footer binds a decoded video frame to its camera crop.
// Black/white cells survive video compression; the viewer removes the footer.
const BYTE_COUNT = 17;
function layout(width: number) {
  const cell = Math.min(4, width), columns = Math.floor(width / cell);
  return { cell, columns, height: Math.ceil(BYTE_COUNT * 8 / columns) * cell };
}
export function remoteFrameFooterHeight(width: number) { return layout(width).height; }
export function writeRemoteFrameMetadata(context: CanvasRenderingContext2D, width: number, height: number, revision: number, timestamp: number, screenHidden = false) {
  // Hidden frames use a distinct marker while retaining the same footer layout.
  const bytes = [0xb0, screenHidden ? 0xa9 : 0xa8];
  let remaining = revision;
  for (let i = 0; i < 8; i++) { bytes.push(remaining % 256); remaining = Math.floor(remaining / 256); }
  remaining = Math.floor(timestamp);
  for (let i = 0; i < 6; i++) { bytes.push(remaining % 256); remaining = Math.floor(remaining / 256); }
  bytes.push(bytes.reduce((sum, byte, index) => (sum + byte * (index + 1)) % 251, 0));
  const grid = layout(width), top = height - grid.height;
  context.fillStyle = "black"; context.fillRect(0, top, width, grid.height);
  context.fillStyle = "white";
  for (let bit = 0; bit < BYTE_COUNT * 8; bit++) {
    if (bytes[Math.floor(bit / 8)]! & (1 << (bit % 8))) {
      context.fillRect(bit % grid.columns * grid.cell, top + Math.floor(bit / grid.columns) * grid.cell, grid.cell, grid.cell);
    }
  }
}
export function readRemoteFrameMetadata(context: CanvasRenderingContext2D, width: number, height: number): { revision: number; timestamp: number; screenHidden: boolean } | null {
  const grid = layout(width);
  if (height <= grid.height) return null;
  const pixels = context.getImageData(0, height - grid.height, width, grid.height).data;
  const bytes = Array<number>(BYTE_COUNT).fill(0);
  for (let bit = 0; bit < BYTE_COUNT * 8; bit++) {
    const x = bit % grid.columns * grid.cell + Math.floor(grid.cell / 2);
    const y = Math.floor(bit / grid.columns) * grid.cell + Math.floor(grid.cell / 2);
    const offset = (y * width + x) * 4;
    if (pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]! > 384) bytes[Math.floor(bit / 8)]! |= 1 << (bit % 8);
  }
  if (bytes[0] !== 0xb0 || (bytes[1] !== 0xa8 && bytes[1] !== 0xa9) || bytes[16] !== bytes.slice(0, 16).reduce((sum, byte, index) => (sum + byte * (index + 1)) % 251, 0)) return null;
  let revision = 0;
  for (let i = 9; i >= 2; i--) revision = revision * 256 + bytes[i]!;
  let timestamp = 0;
  for (let i = 15; i >= 10; i--) timestamp = timestamp * 256 + bytes[i]!;
  return Number.isSafeInteger(revision) ? { revision, timestamp, screenHidden: bytes[1] === 0xa9 } : null;
}
