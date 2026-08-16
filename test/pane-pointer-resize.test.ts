"use strict";

import assert from "node:assert/strict";
import test from "node:test";

const { attachPanePointerResize } = require(`${process.cwd()}/build/renderer/panePointerResize`);

test("shared pane pointer resize captures, moves, commits, and cleans up", () => {
  const documentListeners = new Map<string, (event: unknown) => void>();
  const handleListeners = new Map<string, (event: unknown) => void>();
  const captures: number[] = [];
  const releases: number[] = [];
  const moves: Array<{ clientX: number; startClientX: number }> = [];
  let commits = 0;
  const originalDocument = globalThis.document;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: (event: unknown) => void) {
        documentListeners.set(type, listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        if (documentListeners.get(type) === listener) {
          documentListeners.delete(type);
        }
      }
    }
  });

  const handle = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      handleListeners.set(type, listener);
    },
    releasePointerCapture(pointerId: number) {
      releases.push(pointerId);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      if (handleListeners.get(type) === listener) {
        handleListeners.delete(type);
      }
    },
    setPointerCapture(pointerId: number) {
      captures.push(pointerId);
    }
  };

  try {
    const cleanup = attachPanePointerResize(handle, {
      onCommit() {
        commits += 1;
      },
      onMove(event: { clientX: number }, origin: { clientX: number }) {
        moves.push({ clientX: event.clientX, startClientX: origin.clientX });
      }
    });
    handleListeners.get("pointerdown")?.({
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 7,
      preventDefault() {}
    });
    documentListeners.get("pointermove")?.({ clientX: 145, clientY: 20, pointerId: 7 });
    documentListeners.get("pointerup")?.({ pointerId: 7 });

    assert.deepEqual(captures, [7]);
    assert.deepEqual(releases, [7]);
    assert.deepEqual(moves, [{ clientX: 145, startClientX: 100 }]);
    assert.equal(commits, 1);
    assert.equal(documentListeners.size, 0);

    cleanup();
    assert.equal(handleListeners.size, 0);
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument
    });
  }
});
