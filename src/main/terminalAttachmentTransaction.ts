type TerminalAttachmentTransactionOptions<T> = {
  createSession: () => Promise<unknown>;
  destroySession: () => Promise<unknown>;
  initializeAttachment: () => Promise<T>;
};

export async function runTerminalAttachmentTransaction<T>({
  createSession,
  destroySession,
  initializeAttachment
}: TerminalAttachmentTransactionOptions<T>): Promise<T> {
  await createSession();
  try {
    return await initializeAttachment();
  } catch (error) {
    await destroySession();
    throw error;
  }
}
