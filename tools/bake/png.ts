/** Minimal RGBA PNG encoder, so the pipeline needs nothing beyond node:zlib. */
import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  const line = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const o = y * stride;
    // Per-row choice between Sub and Up by the usual minimum-absolute-sum heuristic.
    let sumSub = 0, sumUp = 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rgba[o + i - 4]! : 0;
      const b = y > 0 ? rgba[o + i - stride]! : 0;
      const s = (rgba[o + i]! - a) & 255, u = (rgba[o + i]! - b) & 255;
      sumSub += s < 128 ? s : 256 - s;
      sumUp += u < 128 ? u : 256 - u;
    }
    const useUp = sumUp < sumSub;
    for (let i = 0; i < stride; i++) {
      const p = useUp ? (y > 0 ? rgba[o + i - stride]! : 0) : (i >= 4 ? rgba[o + i - 4]! : 0);
      line[i] = (rgba[o + i]! - p) & 255;
    }
    raw[y * (stride + 1)] = useUp ? 2 : 1;
    raw.set(line, y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6;
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
