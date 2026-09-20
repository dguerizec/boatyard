type Entry = { expires: number; promise: Promise<unknown> };
const cache = new Map<string, Entry>();
export function cachedGit<T>(key: string, read: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.promise as Promise<T>;
  const promise = read();
  cache.set(key, { expires: Infinity, promise });
  void promise.then(() => {
    const current = cache.get(key); if (current?.promise === promise) current.expires = Date.now() + 2000;
  }, () => { if (cache.get(key)?.promise === promise) cache.delete(key); });
  if (cache.size > 100) for (const [id, value] of cache) if (value.expires < Date.now()) cache.delete(id);
  return promise;
}
