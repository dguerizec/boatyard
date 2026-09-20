export type ByteSelection = { anchor: number; head: number };

/** Map CodeMirror UTF-16 positions to original UTF-8 bytes, including BOM and CRLF. */
export class TextBytePositions {
  private offsets: Uint32Array;
  constructor(text: string, stripBom = true) {
    const offsets = new Uint32Array(text.length + 1);
    let source = stripBom && text.startsWith("\uFEFF") ? 1 : 0;
    let bytes = source ? 3 : 0, position = 0;
    const crlf = text.includes("\r\n");
    offsets[0] = bytes;
    while (source < text.length) {
      const point = text.codePointAt(source)!;
      if (crlf && text.slice(source, source + 2) === "\r\n") {
        source += 2; bytes += 2;
      } else {
        const units = point > 0xffff ? 2 : 1;
        if (units === 2) offsets[++position] = bytes;
        source += units;
        bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      }
      offsets[++position] = bytes;
    }
    this.offsets = offsets.subarray(0, position + 1);
  }
  byte(position: number) { return this.offsets[Math.max(0, Math.min(this.offsets.length - 1, position))]; }
  text(byte: number, ceil: boolean) {
    let low = 0, high = this.offsets.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.offsets[middle] < byte) low = middle + 1;
      else high = middle;
    }
    if (!ceil && this.offsets[low] > byte && low) low--;
    while (low && this.offsets[low - 1] === this.offsets[low]) low--;
    return low;
  }
  toText({ anchor, head }: ByteSelection): ByteSelection {
    if (anchor === head) { const position = this.text(head, false); return { anchor: position, head: position }; }
    return { anchor: this.text(anchor, anchor > head), head: this.text(head, head > anchor) };
  }
}
