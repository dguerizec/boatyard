type Command = { kind: string; action?: string };

function replaceable(command: Command): string | null {
  return command.kind === "viewport" ? "viewport"
    : command.kind === "pointer" && command.action === "move" ? "move" : null;
}

/** Keep current motion instead of replaying obsolete positions behind slow IPC. */
export class RemoteCommandQueue<T extends Command> {
  private pending: T[] = [];
  private running = false;
  constructor(private readonly handle: (command: T) => Promise<void>, private readonly onError: (error: unknown) => void) {}

  push(command: T): void {
    const key = replaceable(command);
    if (key) {
      // Clicks, keys and releases are ordering barriers. Never coalesce across
      // them: their target must retain the camera and pointer state preceding it.
      for (let index = this.pending.length - 1; index >= 0; index--) {
        const previousKey = replaceable(this.pending[index]);
        if (!previousKey) break;
        if (previousKey === key) this.pending.splice(index, 1);
      }
    }
    this.pending.push(command);
    void this.drain();
  }

  clear(): void { this.pending = []; }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        try { await this.handle(this.pending.shift()!); }
        catch (error) { this.onError(error); }
      }
    } finally { this.running = false; }
  }
}
