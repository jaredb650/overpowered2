// Layout of a motion contact sheet (tools/sheet.mjs): which frames go where, how big, and the page that draws them.
// Pure: numbers and strings only.

/** `want` frame numbers spread evenly over `count` frames, first and last included. All of them when `want` >= `count`. */
export function pick(count, want) {
  if (count <= 0) return [];
  if (!want || want >= count) return Array.from({ length: count }, (_, i) => i);
  if (want === 1) return [0];
  return Array.from({ length: want }, (_, i) => Math.round(i * (count - 1) / (want - 1)));
}

/**
 * A grid of `count` tiles, `cols` across, each `tile` pixels wide and as tall as the frame's shape asks, with a caption strip
 * under each and a header line on top. Returns the sheet size and each tile's place.
 */
export function layout({ count, cols = 6, tile = 480, frameW, frameH, caption = 24, gap = 6, header = 30 }) {
  const across = Math.max(1, Math.min(cols, count));
  const rows = Math.max(1, Math.ceil(count / across));
  const tileH = Math.max(1, Math.round(tile * frameH / frameW));
  const cells = Array.from({ length: count }, (_, i) => ({
    x: gap + (i % across) * (tile + gap),
    y: header + Math.floor(i / across) * (tileH + caption + gap),
    w: tile,
    h: tileH,
  }));
  return {
    cols: across, rows, tileW: tile, tileH, caption,
    width: gap + across * (tile + gap),
    height: header + rows * (tileH + caption + gap),
    cells,
  };
}

/** The text under a tile: frame number and its time after the first frame. */
export function label(index, ms) {
  return `#${String(index + 1).padStart(2, '0')}  ${ms < 0 ? '-' : '+'}${Math.abs(Math.round(ms))} ms`;
}

const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The page that draws the sheet. `tiles` are { src, text } in order; `grid` is what layout() returned. */
export function sheetHtml({ grid, tiles, title }) {
  const cells = tiles.map((t, i) => {
    const c = grid.cells[i];
    return `<img src="${escape(t.src)}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px">`
      + `<div class="cap" style="left:${c.x}px;top:${c.y + c.h}px;width:${c.w}px;height:${grid.caption}px;line-height:${grid.caption}px">${escape(t.text)}</div>`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#14161b;width:${grid.width}px;height:${grid.height}px;overflow:hidden}
img,.cap,.head{position:absolute;display:block}
img{object-fit:fill;background:#000}
.cap{font:600 15px ui-monospace,'DejaVu Sans Mono',Menlo,Consolas,monospace;color:#e8eaf0;text-align:center;white-space:pre}
.head{left:8px;top:0;height:30px;font:14px/30px ui-monospace,'DejaVu Sans Mono',Menlo,Consolas,monospace;color:#8f96a8;white-space:pre}
</style><div class="head">${escape(title)}</div>
${cells}`;
}
