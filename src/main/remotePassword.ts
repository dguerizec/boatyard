import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, (error, key) => error ? reject(error) : resolve(key)));
}

export function isRemotePasswordHash(value: unknown): value is string {
  return typeof value === "string" && /^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(value);
}

export async function hashRemotePassword(password: string): Promise<string> {
  if (!password || password.length > 1024) throw new Error("Enter a password between 1 and 1024 characters.");
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyRemotePassword(password: string, hash: string): Promise<boolean> {
  if (!isRemotePasswordHash(hash) || !password || password.length > 1024) return false;
  const [, salt, digest] = hash.split(":");
  return timingSafeEqual(await derive(password, salt), Buffer.from(digest, "hex"));
}
