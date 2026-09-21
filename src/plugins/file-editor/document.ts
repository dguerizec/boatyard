import { FileChanges, type FilePatch } from "./changes";
import { byteContent, contentBytes, sameContent, type ByteEncoding } from "./bytes";
import type { FileSnapshot } from "./service";

export type EditorDraft = FileSnapshot & { baseText: string; baseEncoding?: ByteEncoding };
export type FileAccess = {
  read(path: string): Promise<FileSnapshot>;
  rebaseChanges?(path: string, revision: string, patches: FilePatch[], size: number): Promise<FilePatch[]>;
  saveChanges?(path: string, revision: string, patches: FilePatch[]): Promise<FileSnapshot>;
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
  saving = false;
  private refreshPending: Promise<void> | null = null;
  readonly listeners = new Set<() => void>();

  constructor(snapshot: FileSnapshot, private access: FileAccess, draft?: EditorDraft, public changes?: FileChanges) {
    this.disk = snapshot;
    this.base = draft ? { block: draft.block, path: snapshot.path, text: draft.baseText, encoding: draft.baseEncoding, revision: draft.revision } : snapshot;
    this.text = draft?.text ?? snapshot.text;
    this.encoding = draft ? draft.encoding : snapshot.encoding;
    if (sameContent(this, snapshot)) this.base = snapshot;
    if (changes) {
      if (draft && !changes.dirty) changes.edit(this.base, contentBytes(this));
      this.applyChanges();
    }
  }

  private detachChanges?: () => void;
  connectChanges() {
    if (!this.changes || this.detachChanges) return;
    const listener = () => {
      if (this.base.revision !== this.changes!.revision) { void this.refresh(); return; }
      this.applyChanges(); this.notify();
    };
    this.changes.listeners.add(listener);
    this.detachChanges = () => this.changes!.listeners.delete(listener);
  }
  disconnectChanges() { this.detachChanges?.(); this.detachChanges = undefined; }
  private applyChanges() {
    if (!this.changes) return;
    if (!this.changes.hasBlock(this.base.block!.index)) {
      this.text = this.base.text; this.encoding = this.base.encoding; return;
    }
    try {
      const content = byteContent(this.changes.apply(this.base));
      this.text = content.text; this.encoding = content.encoding;
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }
  get locked() { return this.saving || Boolean(this.changes && (this.changes.saving || this.base.revision !== this.changes.revision)); }
  get dirty() { return this.changes ? this.changes.dirty : !sameContent(this, this.base); }
  get conflict() { return this.changes ? this.changes.conflict : this.disk.revision !== this.base.revision; }

  notify() { for (const listener of this.listeners) listener(); }

  edit(text: string) {
    if (this.locked && this.base.block) return;
    this.encoding = undefined;
    this.text = text;
    this.changes?.edit(this.base, this.bytes);
    this.notify();
  }

  get bytes() { return contentBytes(this); }
  editBytes(bytes: Uint8Array) {
    if (this.locked && this.base.block) return;
    const content = byteContent(bytes);
    this.text = content.text;
    this.encoding = content.encoding;
    this.changes?.edit(this.base, bytes);
    this.notify();
  }

  async refresh() {
    if (this.busy || this.changes?.saving) return;
    const revision = this.changes?.revision;
    let retry = false;
    this.busy = true;
    let finish!: () => void;
    this.refreshPending = new Promise<void>((resolve) => { finish = resolve; });
    try {
      const snapshot = await this.access.read(this.base.path);
      if (this.changes && revision !== this.changes.revision && snapshot.revision !== this.changes.revision) {
        retry = true; return;
      }
      this.changes?.observe(snapshot);
      // A user may have started editing while the disk read was in flight.
      if (!this.dirty || (this.changes && snapshot.revision === this.changes.revision) || (!this.changes && sameContent(snapshot, this))) {
        this.base = snapshot;
        this.text = snapshot.text;
        this.encoding = snapshot.encoding;
      }
      this.disk = snapshot;
      if (snapshot.block && !this.changes && !this.dirty) { this.changes = new FileChanges(snapshot); this.connectChanges(); }
      this.error = "";
      this.applyChanges();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.refreshPending = null;
      finish();
      this.notify();
      if (retry) queueMicrotask(() => { void this.refresh(); });
    }
  }

  async save() {
    if (this.refreshPending) await this.refreshPending;
    if (this.busy || this.changes?.saving || !this.dirty || this.conflict) return;
    this.busy = true;
    this.saving = true;
    if (this.changes) { this.changes.saving = true; this.changes.notify(); }
    this.error = "";
    this.notify();
    const text = this.text;
    const encoding = this.encoding;
    try {
      const snapshot = this.changes && this.access.saveChanges
        ? await this.access.saveChanges(this.base.path, this.changes.revision, this.changes.edits)
        : await this.access.save(this.base.path, text, this.base.revision, encoding);
      if (snapshot.block) {
        // Reindexing may pull adjacent bytes into this block after a size change.
        this.text = snapshot.text;
        this.encoding = snapshot.encoding;
      }
      this.base = snapshot;
      this.disk = snapshot;
      if (snapshot.block && !this.changes) { this.changes = new FileChanges(snapshot); this.connectChanges(); }
      this.changes?.reset(snapshot);
      // Keep edits made while the save was in flight.
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.saving = false;
      if (this.changes) { this.changes.saving = false; this.changes.notify(); }
      this.notify();
    }
  }

  useDisk() {
    this.text = this.disk.text;
    this.encoding = this.disk.encoding;
    this.base = this.disk;
    this.error = "";
    this.changes?.reset(this.disk);
    this.notify();
  }

  /** Accept the compared disk revision; a later save still checks it again. */
  async keepDraft() {
    if (this.changes?.conflict) {
      if (this.busy || this.changes.saving || !this.access.rebaseChanges) return;
      this.busy = true; this.changes.saving = true; this.changes.notify();
      const disk = this.disk;
      try {
        const patches = await this.access.rebaseChanges(this.base.path, disk.revision, this.changes.edits, this.changes.size);
        this.base = disk;
        this.changes.rebase(disk.revision, patches);
        this.error = "";
      } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
      finally { this.busy = false; this.changes.saving = false; this.changes.notify(); this.notify(); }
      return;
    }
    this.base = this.disk;
    this.error = "";
    this.applyChanges();
    this.notify();
  }

  draft(): EditorDraft | null {
    return !this.changes && this.dirty ? { ...this.base, baseText: this.base.text, baseEncoding: this.base.encoding, text: this.text, encoding: this.encoding } : null;
  }
}
