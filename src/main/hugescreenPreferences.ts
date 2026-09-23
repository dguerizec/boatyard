import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeHugescreenZones, parseHugescreenZones, type HugescreenZones } from "../renderer/hugescreenZones.js";

/** Machine-local preferences shared by all configuration profiles in this Electron installation. */
export class HugescreenPreferences {
  private zones: HugescreenZones | undefined;

  constructor(private readonly filePath: string) {}

  getZones(legacy?: HugescreenZones): HugescreenZones {
    if (!this.zones) {
      if (existsSync(this.filePath)) {
        try {
          this.zones = normalizeHugescreenZones(JSON.parse(readFileSync(this.filePath, "utf8")).edgeZones);
        } catch (error) {
          console.warn(`Could not read Hugescreen preferences at ${this.filePath}: ${(error as Error).message}`);
          this.zones = normalizeHugescreenZones(legacy);
        }
      } else {
        this.setZones(normalizeHugescreenZones(legacy));
      }
    }
    return { ...this.zones! };
  }

  setZones(value: unknown): void {
    const zones = parseHugescreenZones(value);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ edgeZones: zones }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.filePath);
    this.zones = zones;
  }
}
