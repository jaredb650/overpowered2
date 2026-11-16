// A man getting bloodier: the same holes at bloodiness 0, 0.35, 0.7 and 1, side by side. Stains run further down with it.
//   node tools/shot.mjs --port 5288 --url "/?sandbox=models&archetype=gunner&view=front" --dpr 2 --w 1440 --h 900 --wait 6000 \
//     --quiet --script tools/scripts/gore-b-wet.mjs --out tools/out/gore-b/wet.png
import { writeFileSync, mkdirSync } from 'node:fs';

export default async function run(page) {
  const url = await page.evaluate(async () => {
    const m = window.__m;
    m.pause();
    const c = m.focus;
    const V = c.root.position.constructor;
    // Front of the body: chest, belly, a thigh, each a hole and a bigger exit-style crater, with the shot going in along -z.
    const spots = [[2, 0.08, 1.32], [1, -0.06, 1.08], [11, 0.1, 0.72], [2, -0.12, 1.42]];
    for (const [bone, x, y] of spots) {
      const p = c.root.position.clone().add(new V(x, y, 0.15));
      c.wound({ kind: 2, bone, point: p, dir: new V(0, 0, -1), radius: 0.02, depth: 0.06, ragged: 0.7 });
    }
    const gl = m.render.renderer.domElement;
    const sheet = document.createElement('canvas');
    const levels = [0, 0.35, 0.7, 1];
    const cw = Math.round(gl.width * 0.32), ch = Math.round(gl.height * 0.86);
    sheet.width = cw * levels.length;
    sheet.height = ch;
    const g = sheet.getContext('2d');
    g.font = '24px monospace';
    for (let i = 0; i < levels.length; i++) {
      c.setBloodiness(levels[i]);
      for (let k = 0; k < 3; k++) { m.step(1 / 60); await new Promise(r => requestAnimationFrame(r)); }
      g.drawImage(gl, (gl.width - cw) / 2, gl.height * 0.06, cw, ch, i * cw, 0, cw, ch);
      g.fillStyle = '#fff';
      g.fillText(`bloodiness ${levels[i]}`, i * cw + 10, 30);
    }
    return sheet.toDataURL('image/png');
  });
  mkdirSync('tools/out/gore-b', { recursive: true });
  writeFileSync('tools/out/gore-b/wet.png', Buffer.from(url.split(',')[1], 'base64'));
  return 'tools/out/gore-b/wet.png';
}
