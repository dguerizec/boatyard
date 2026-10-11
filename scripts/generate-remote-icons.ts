import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Keep the official artwork intact; only the frame and mode badge are added.
const artwork = "src/renderer/assets/boatyard-icon.png";
const modes = {
  remote: {
    color: "#ff5b49",
    symbol: "fill white stroke white stroke-width 5 stroke-linejoin round path 'M357 337 L357 432 L380 410 L400 445 L420 433 L400 400 L435 395 Z'"
  },
  share: {
    color: "#009cff",
    symbol: "fill none stroke white stroke-width 12 stroke-linecap round stroke-linejoin round path 'M365 349 H435 V412 H410' path 'M350 380 A53 53 0 0 1 403 433 M350 407 A26 26 0 0 1 376 433' fill white stroke none circle 350,433 357,433"
  }
};

for (const [mode, { color, symbol }] of Object.entries(modes)) {
  const directory = join("src/renderer/remote/icons", mode);
  mkdirSync(directory, { recursive: true });
  const overlay = `fill none stroke '${color}' stroke-width 24 roundrectangle 14,14 498,498 92,92
    stroke none fill '#fff8eb' circle 392,392 490,392
    fill '${color}' circle 392,392 480,392 ${symbol}`;
  for (const [file, size] of [["icon-512.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180], ["favicon.png", 32]] as const) {
    const result = spawnSync("magick", [artwork, "-resize", "512x512",
      "(", "+clone", "-alpha", "transparent", "-fill", "white", "-draw", "roundrectangle 0,0 511,511 106,106", ")",
      "-alpha", "off", "-compose", "CopyOpacity", "-composite",
      "-compose", "Over", "-draw", overlay,
      "-resize", `${size}x${size}`, `PNG32:${join(directory, file)}`], { encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Could not render ${mode}/${file}: ${result.stderr}`);
  }
}
