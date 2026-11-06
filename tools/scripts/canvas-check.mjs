// Fast check, no game boot needed: is the canvas drawn at exactly the window size?
export default async function canvasCheck(page, h) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => (document.getElementById('game')?.width ?? 0) > 300)) break;
    await h.sleep(500);
  }
  return page.evaluate(() => {
    const c = document.getElementById('game');
    const r = c.getBoundingClientRect();
    return {
      dpr: devicePixelRatio, window: [innerWidth, innerHeight], buffer: [c.width, c.height],
      canvasCss: [r.width, r.height],
      imageCentre: [r.left + r.width / 2, r.top + r.height / 2],
      crosshairAt: [innerWidth / 2, innerHeight / 2],
      offsetPx: [r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight / 2],
    };
  });
}
