const TILE_SIZE = 1024;
const OVERVIEW_SIZE = 2048;

/** Pin decoded tiles, then draw only the visible region into a viewport-sized canvas. */
export function createImageSurface() {
  const canvas = document.createElement("canvas");
  canvas.className = "file-editor-image-surface";
  canvas.setAttribute("role", "img");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image preview requires a canvas context");
  let generation = 0;
  let tiles: { x: number; y: number; bitmap: ImageBitmap }[] = [];
  let overview: ImageBitmap | undefined;
  let pixelOverview: ImageBitmap | undefined;
  let imageWidth = 0, imageHeight = 0;
  let previousDraw: number[] | undefined;

  function clear() {
    generation++;
    for (const tile of tiles) tile.bitmap.close();
    tiles = [];
    overview?.close(); overview = undefined;
    pixelOverview?.close(); pixelOverview = undefined;
    imageWidth = imageHeight = 0;
    previousDraw = undefined;
    // Resizing releases the canvas backing store as well as clearing its pixels.
    canvas.width = canvas.height = 0;
  }

  return {
    canvas, clear,
    async prepare(image: HTMLImageElement) {
      clear();
      const version = generation;
      const width = image.naturalWidth, height = image.naturalHeight;
      let decoded: ImageBitmap | undefined;
      try {
        // Retain one decoded source during preparation instead of decoding the PNG for each crop.
        decoded = await createImageBitmap(image);
        if (version !== generation) return false;
        const ratio = Math.min(1, OVERVIEW_SIZE / Math.max(width, height));
        const thumbnail = await createImageBitmap(decoded, {
          resizeWidth: Math.max(1, Math.round(width * ratio)),
          resizeHeight: Math.max(1, Math.round(height * ratio)), resizeQuality: "high"
        });
        if (version !== generation) { thumbnail.close(); return false; }
        overview = thumbnail;
        const nearest = await createImageBitmap(decoded, {
          resizeWidth: thumbnail.width, resizeHeight: thumbnail.height, resizeQuality: "pixelated"
        });
        if (version !== generation) { nearest.close(); return false; }
        pixelOverview = nearest;
        for (let y = 0; y < height; y += TILE_SIZE) for (let x = 0; x < width; x += TILE_SIZE) {
          const bitmap = await createImageBitmap(decoded, x, y, Math.min(TILE_SIZE, width - x), Math.min(TILE_SIZE, height - y));
          if (version !== generation) { bitmap.close(); return false; }
          tiles.push({ x, y, bitmap });
          // Preparation may be substantial; keep navigation and cancellation responsive.
          if (tiles.length % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
          if (version !== generation) return false;
        }
        imageWidth = width; imageHeight = height;
        canvas.setAttribute("aria-label", image.alt);
        return true;
      } catch (error) {
        if (version !== generation) return false;
        clear();
        throw error;
      } finally { decoded?.close(); }
    },
    draw(width: number, height: number, scale: number, x: number, y: number, pixelated: boolean) {
      if (!imageWidth || !imageHeight || width <= 0 || height <= 0) return;
      const ratio = window.devicePixelRatio || 1;
      const values = [width, height, scale, x, y, Number(pixelated), ratio];
      if (previousDraw?.every((value, index) => value === values[index])) return;
      previousDraw = values;
      const pixelWidth = Math.ceil(width * ratio), pixelHeight = Math.ceil(height * ratio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = !pixelated;
      // The overview avoids visiting hundreds of full-resolution tiles at small zooms.
      const thumbnail = pixelated ? pixelOverview : overview;
      if (thumbnail && scale * ratio <= thumbnail.width / imageWidth) {
        context.drawImage(thumbnail, x, y, imageWidth * scale, imageHeight * scale);
        return;
      }
      const left = -x / scale, top = -y / scale;
      const right = (width - x) / scale, bottom = (height - y) / scale;
      for (const tile of tiles) {
        const { bitmap } = tile;
        if (tile.x >= right || tile.y >= bottom || tile.x + bitmap.width <= left || tile.y + bitmap.height <= top) continue;
        context.drawImage(bitmap, x + tile.x * scale, y + tile.y * scale, bitmap.width * scale, bitmap.height * scale);
      }
    }
  };
}
