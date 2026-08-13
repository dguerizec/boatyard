type TerminalAttachment = {
  terminalId: string;
};

type TerminalAttachmentAttempt = {
  generation: number;
  projectId: string;
  surfaceId: string;
};

type TerminalAttachmentCoordinatorOptions<T extends TerminalAttachment> = {
  discardAttachment: (attachment: T) => Promise<unknown> | unknown;
};

export function createTerminalAttachmentCoordinator<T extends TerminalAttachment>({
  discardAttachment
}: TerminalAttachmentCoordinatorOptions<T>) {
  const attemptBySurface = new Map<string, TerminalAttachmentAttempt>();
  let nextGeneration = 1;

  function begin(surfaceId: string, projectId: string): TerminalAttachmentAttempt {
    const attempt = {
      generation: nextGeneration,
      projectId,
      surfaceId
    };
    nextGeneration += 1;
    attemptBySurface.set(surfaceId, attempt);
    return attempt;
  }

  function isCurrent(attempt: TerminalAttachmentAttempt): boolean {
    return attemptBySurface.get(attempt.surfaceId)?.generation === attempt.generation;
  }

  function cancel(attempt: TerminalAttachmentAttempt): void {
    if (isCurrent(attempt)) {
      attemptBySurface.delete(attempt.surfaceId);
    }
  }

  function invalidate(surfaceId: string): void {
    attemptBySurface.delete(surfaceId);
  }

  function invalidateProject(projectId: string): void {
    for (const [surfaceId, attempt] of attemptBySurface.entries()) {
      if (attempt.projectId === projectId) {
        attemptBySurface.delete(surfaceId);
      }
    }
  }

  function invalidateInactiveProjects(activeProjectId: string | null): void {
    for (const [surfaceId, attempt] of attemptBySurface.entries()) {
      if (attempt.projectId !== activeProjectId) {
        attemptBySurface.delete(surfaceId);
      }
    }
  }

  function complete(attempt: TerminalAttachmentAttempt): boolean {
    if (!isCurrent(attempt)) {
      return false;
    }
    attemptBySurface.delete(attempt.surfaceId);
    return true;
  }

  async function discard(attempt: TerminalAttachmentAttempt, attachment: T): Promise<void> {
    cancel(attempt);
    await discardAttachment(attachment);
  }

  return Object.freeze({
    begin,
    cancel,
    complete,
    discard,
    invalidate,
    invalidateInactiveProjects,
    invalidateProject,
    isCurrent
  });
}

export type { TerminalAttachmentAttempt };
