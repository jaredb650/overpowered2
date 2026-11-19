// Pixel helpers for the dev tools (tools/diff.mjs). Pure: RGBA byte arrays in, RGBA byte arrays and numbers out. No files, no browser.
// An "image" here is { width, height, data } with data a Uint8Array of width * height * 4 bytes.
import pixelmatch from 'pixelmatch';

/**
 * Compares two images of one size.
 *   changed  pixels that differ by more than `threshold` (0 to 1; 0 counts every visible difference). Anti-aliased edge
 *            pixels are not counted unless `aa` is true.
 *   exact    pixels whose bytes differ at all, whatever the threshold
 *   bbox     the box around the changed pixels, or null when none changed
 *   diff     a picture: the first image faded to grey, changed pixels red, ignored edge pixels yellow
 */
export function compare(a, b, { threshold = 0.1, aa = false } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`The pictures are not the same size: ${a.width}x${a.height} against ${b.width}x${b.height}. Take both at one --w, --h and --dpr.`);
  }
  const { width, height } = a;
  const out = new Uint8Array(width * height * 4);
  const changed = pixelmatch(a.data, b.data, out, width, height, { threshold, includeAA: aa });
  let exact = 0;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) exact++;
      // pixelmatch paints a changed pixel pure red; the faded background is always grey, so red means changed.
      if (out[i] === 255 && out[i + 1] === 0 && out[i + 2] === 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const total = width * height;
  return {
    changed, exact, total,
    percent: round(changed / total * 100, 4),
    bbox: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    diff: { width, height, data: out },
  };
}

const round = (n, places) => Number(n.toFixed(places));

/** A box grown by `pad` pixels on every side and kept inside the picture. */
export function padBox(box, pad, width, height) {
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  return { x, y, w: Math.min(width, box.x + box.w + pad) - x, h: Math.min(height, box.y + box.h + pad) - y };
}

/** The part of a picture inside a box. */
export function crop(image, box) {
  const data = new Uint8Array(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const from = ((box.y + y) * image.width + box.x) * 4;
    data.set(image.data.subarray(from, from + box.w * 4), y * box.w * 4);
  }
  return { width: box.w, height: box.h, data };
}

/** Shrinks a picture to `width` pixels wide by averaging (never enlarges). Each new pixel is the mean of the pixels it covers. */
export function shrink(image, width) {
  if (width >= image.width) return image;
  const height = Math.max(1, Math.round(image.height * width / image.width));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor(y * image.height / height), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * image.height / height));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor(x * image.width / width), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * image.width / width));
      let r = 0, g = 0, b = 0, al = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0, i = (sy * image.width + sx0) * 4; sx < sx1; sx++, i += 4) {
          r += image.data[i]; g += image.data[i + 1]; b += image.data[i + 2]; al += image.data[i + 3];
        }
      }
      const n = (sy1 - sy0) * (sx1 - sx0), o = (y * width + x) * 4;
      data[o] = Math.round(r / n); data[o + 1] = Math.round(g / n); data[o + 2] = Math.round(b / n); data[o + 3] = Math.round(al / n);
    }
  }
  return { width, height, data };
}

/** Lays pictures left to right with a gap between them, on a dark background, tops level. */
export function strip(panels, gap = 8, background = [24, 26, 32, 255]) {
  const width = panels.reduce((sum, p) => sum + p.width, 0) + gap * (panels.length - 1);
  const height = Math.max(...panels.map(p => p.height));
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(background, i);
  let left = 0;
  for (const p of panels) {
    for (let y = 0; y < p.height; y++) data.set(p.data.subarray(y * p.width * 4, (y + 1) * p.width * 4), (y * width + left) * 4);
    left += p.width + gap;
  }
  return { width, height, data };
}
