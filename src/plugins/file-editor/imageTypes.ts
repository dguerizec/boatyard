const imageTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml"
};
export function imageMimeType(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : undefined;
}
export type ImageSnapshot = { path: string; dataUrl: string; size: number };
