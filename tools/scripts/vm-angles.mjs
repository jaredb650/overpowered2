// Captures several inspection angles of the current sandbox URL in one browser session.
export default async function (page, h) {
  await page.evaluate(() => { const c = document.querySelector('#game'); c.style.outline = '0'; });
  const angles = (process.env.VM_ANGLES ?? '120:12,60:12,180:15,250:25').split(',');
  for (const a of angles) {
    const [yaw, pitch, dist] = a.split(':').map(Number);
    await page.evaluate(([y, p, d]) => {
      const v = window.__vm;
      v.pivot.rotation.set(p * Math.PI / 180, y * Math.PI / 180, 0, 'XYZ');
      if (d) v.pivot.position.z = -d;
    }, [yaw, pitch, dist]);
    await h.sleep(250);
    await h.shot(`${yaw}_${pitch}`);
  }
}
