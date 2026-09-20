export type ByteEncoding = "hex";
export type ByteContent = { text: string; encoding?: ByteEncoding };
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function contentBytes(content: ByteContent): Uint8Array {
  if (content.encoding !== "hex") return new TextEncoder().encode(content.text);
  if (!/^(?:[\da-f]{2})*$/i.test(content.text)) throw new Error("Invalid hexadecimal bytes.");
  return Uint8Array.from(content.text.match(/../g) || [], (pair) => parseInt(pair, 16));
}
export function byteContent(bytes: Uint8Array): ByteContent {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!text.includes("\0")) return { text };
  } catch { /* Binary content remains editable in Hex mode. */ }
  return { text: bytesToHex(bytes), encoding: "hex" };
}
export function sameContent(a: ByteContent, b: ByteContent): boolean {
  if (a.encoding === b.encoding) return a.text === b.text;
  return bytesToHex(contentBytes(a)) === bytesToHex(contentBytes(b));
}
