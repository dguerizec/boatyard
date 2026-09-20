import { byteContent, contentBytes, sameContent, type ByteEncoding } from "./bytes";
import type { FileSnapshot } from "./service";

export type EditorDraft = FileSnapshot & { baseText: string; baseEncoding?: ByteEncoding };
export type FileAccess = {
  read(path: string): Promise<FileSnapshot>;
  save(path: string, text: string, revision: string, encoding?: ByteEncoding): Promise<FileSnapshot>;
};

/** One document per file, shared by every visible editor pane. */
export class EditorDocument {
  text: string;
  encoding?: ByteEncoding;
  base: FileSnapshot;
  disk: FileSnapshot;
  error = "";
  busy = false;
  private refreshPending: Promise<void> | null = null;
  readonly listeners = new Set<() => void>();

  constructor(snapshot: FileSnapshot, private access: FileAccess, draft?: EditorDraft) {
    this.disk = snapshot;
    this.base = draft ? { path: snapshot.path, text: draft.baseText, encoding: draft.baseEncoding, revision: draft.revision } : snapshot;
    this.text = draft?.text ?? snapshot.text;
    this.encoding = draft ? draft.encoding : snapshot.encoding;
    if (sameContent(this, snapshot)) this.base = snapshot;
  }

  get dirty() { return !sameContent(this, this.base); }
  get conflict() { return this.disk.revision !== this.base.revision; }

  notify() { for (const listener of this.listeners) listener(); }

  edit(text: string) {
    this.encoding = undefined;
    this.text = text;
    this.notify();
  }

  get bytes() { return contentBytes(this); }
  editBytes(bytes: Uint8Array) {
    const content = byteContent(bytes);
    this.text = content.text;
    this.encoding = content.encoding;
    this.notify();
  }

  async refresh() {
    if (this.busy) return;
    this.busy = true;
    let finish!: () => void;
    this.refreshPending = new Promise<void>((resolve) => { finish = resolve; });
    try {
      const snapshot = await this.access.read(this.base.path);
      // A user may have started editing while the disk read was in flight.
      if (!this.dirty || sameContent(snapshot, this)) {
        this.base = snapshot;
        this.text = snapshot.text;
        this.encoding = snapshot.encoding;
      }
      this.disk = snapshot;
      this.error = "";
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.refreshPending = null;
      finish();
      this.notify();
    }
  }

  async save() {
    if (this.refreshPending) await this.refreshPending;
    if (this.busy || !this.dirty || this.conflict) return;
    this.busy = true;
    this.error = "";
    this.notify();
    const text = this.text;
    const encoding = this.encoding;
    try {
      const snapshot = await this.access.save(this.base.path, text, this.base.revision, encoding);
      this.base = snapshot;
      this.disk = snapshot;
      // Keep edits made while the save was in flight.
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  useDisk() {
    this.text = this.disk.text;
    this.encoding = this.disk.encoding;
    this.base = this.disk;
    this.error = "";
    this.notify();
  }

  /** Accept the compared disk revision; a later save still checks it again. */
  keepDraft() {
    this.base = this.disk;
    this.error = "";
    this.notify();
  }

  draft(): EditorDraft | null {
    return this.dirty ? { ...this.base, baseText: this.base.text, baseEncoding: this.base.encoding, text: this.text, encoding: this.encoding } : null;
  }
}
