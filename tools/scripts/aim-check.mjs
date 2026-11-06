// Proves the camera centre lands on the window centre, where the crosshair is. Run at --dpr 2 as well as 1.
export default async function aimCheck(page, h) {
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => window.__op2?.game?.state === 'playing')) break;
    await h.sleep(1000);
  }
  await h.sleep(1500);
  await h.shot('view');
  return page.evaluate(() => {
    const { ctx } = window.__op2;
    const canvas = ctx.render.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const cross = document.querySelector('[class*=crosshair], [id*=crosshair]')?.getBoundingClientRect();
    const fix = n => Math.round(n * 10) / 10;
    return {
      dpr: devicePixelRatio,
      window: [innerWidth, innerHeight],
      canvasCss: [fix(rect.width), fix(rect.height)],
      buffer: [canvas.width, canvas.height],
      imageCentre: [fix(rect.left + rect.width / 2), fix(rect.top + rect.height / 2)],
      windowCentre: [innerWidth / 2, innerHeight / 2],
      crosshairCentre: cross ? [fix(cross.left + cross.width / 2), fix(cross.top + cross.height / 2)] : null,
      offsetPx: [fix(rect.left + rect.width / 2 - innerWidth / 2), fix(rect.top + rect.height / 2 - innerHeight / 2)],
    };
  });
}
