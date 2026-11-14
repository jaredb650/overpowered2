// The identification sheet (docs/proposals/mission-2-plan.md, stage 1): a Bailiff (left) and a heavy Bailiff (right) either side of
// each human enemy type, at 10, 25 and 50 m on the Test Range, through the game's own camera and lens, and the 25 m tile again in
// grey to judge them by value alone. Each tile is the same middle of the frame, so the 50 m men are as small as the player sees them.
//   node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/bureau-sheet.mjs --dpr 2 --w 1440 --h 900 \
//     --wait 500 --timeout 200 --out tools/out/bureau/sheet.png
// SHEET_TYPES="trooper,brute" picks the enemies.
import { writeFileSync } from 'node:fs';

const TYPES = (process.env.SHEET_TYPES ?? 'trooper,gunner,brute,rocketeer,sniper,riot,warden').split(',');
const DISTANCES = [10, 25, 50];
const AHEAD = Number(process.env.SHEET_AHEAD ?? 0);

export default async function sheet(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__allies && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  await page.evaluate(() => window.__op2.ctx.allies.preload());
  const report = await page.evaluate(([TYPES, DISTANCES, AHEAD]) => {
    const { ctx } = window.__op2;
    const cam = ctx.render.camera;
    const V = ctx.player.position.constructor;
    // The line-up stands where the camera can back away from it 55 m along a clear bearing at eye height: the nearest such spot to
    // the spawn, on the floor, looked for on a 20 m grid.
    const spawn = ctx.player.position.clone();
    const clearFrom = (q, dir) => {
      const hit = ctx.physics.raycast(q.clone().setY(q.y + 1.6), dir, 60, 1);
      return hit ? hit.distance : 60;
    };
    let p = null, f = null, best = 0;
    for (let r = 0; r <= 160 && best < 56; r += 20) {
      for (let gx = -r; gx <= r; gx += 20) for (let gz = -r; gz <= r; gz += 20) {
        if (Math.max(Math.abs(gx), Math.abs(gz)) !== r) continue;
        const q = new V(spawn.x + gx, spawn.y + 1, spawn.z + gz);
        if (!ctx.world.nav.nearest(q, 6, q)) continue;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const dir = new V(Math.sin(a), 0, Math.cos(a));
          const clear = clearFrom(q, dir);
          if (clear > best) { best = clear; p = q.clone(); f = dir.clone().negate(); }
        }
      }
    }
    const side = new V(f.z, 0, -f.x);
    const center = p.clone().addScaledVector(f, AHEAD);
    const facing = Math.atan2(-f.x, -f.z);
    const loco = { speed: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, grounded: true };
    const canvas = document.querySelector('canvas');
    const cols = DISTANCES.length + 1;
    const w = Math.floor(canvas.width / cols);
    const hh = Math.floor(w * 0.75);
    const out = document.createElement('canvas');
    out.width = w * cols;
    out.height = hh * TYPES.length;
    const g = out.getContext('2d');
    const dpr = devicePixelRatio;
    g.font = `${11 * dpr}px monospace`;
    ctx.time.paused = true;
    ctx.render.viewScene.visible = false;
    const lums = [];
    TYPES.forEach((type, row) => {
      const men = [ctx.allies.body('rifleman'), ctx.characters.spawn(type), ctx.allies.body('gunner')];
      for (const c of men) ctx.render.scene.add(c.root);
      const tiles = [...DISTANCES, 25];
      tiles.forEach((d, col) => {
        const grey = col === DISTANCES.length;
        const at = center;
        men.forEach((c, i) => {
          c.root.position.copy(at).addScaledVector(side, (i - 1) * 1.1);
          c.root.rotation.y = facing;
          c.setLod?.(d < 26 ? 0 : d < 60 ? 1 : 2);
          c.anim.setLocomotion(loco);
          for (let k = 0; k < 30; k++) c.anim.update(1 / 60, 0);
          c.root.updateMatrixWorld(true);
        });
        cam.position.copy(at).addScaledVector(f, -d).setY(at.y + 1.65);
        cam.lookAt(at.x, at.y + 1.1, at.z);
        cam.updateMatrixWorld(true);
        ctx.render.render();
        // The middle fifth of the frame, in the tile's aspect: the same window at every distance.
        const sw = canvas.width * 0.22, sh = sw * 0.75;
        g.filter = grey ? 'grayscale(1)' : 'none';
        g.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, col * w, row * hh, w, hh);
        g.filter = 'none';
        g.fillStyle = '#ffee44';
        g.fillText(`${type}  ${d} m${grey ? '  value' : ''}`, col * w + 6 * dpr, row * hh + 14 * dpr);
        if (grey) {
          // Mean value of each body's middle, from its projected chest, for the report.
          const px = g.getImageData(col * w, row * hh, w, hh).data;
          const lum = men.map(c => {
            const s = c.root.position.clone().setY(c.root.position.y + 1.2).project(cam);
            const u = (s.x * 0.5 + 0.5) * canvas.width, v = (-s.y * 0.5 + 0.5) * canvas.height;
            const tx = ((u - (canvas.width - sw) / 2) / sw) * w, ty = ((v - (canvas.height - sh) / 2) / sh) * hh;
            let sum = 0, n = 0;
            for (let y = -6; y <= 6; y++) for (let x = -3; x <= 3; x++) {
              const i = ((Math.round(ty) + y) * w + Math.round(tx) + x) * 4;
              sum += px[i]; n++;
            }
            return Math.round(sum / n);
          });
          lums.push({ type, bailiff: lum[0], enemy: lum[1], heavy: lum[2] });
        }
      });
      for (const c of men) {
        c.root.removeFromParent();
        ctx.allies.props.strip(c);
        c.release();
      }
    });
    ctx.time.paused = false;
    ctx.render.viewScene.visible = true;
    return { lums, clear: Math.round(best), png: out.toDataURL('image/png') };
  }, [TYPES, DISTANCES, AHEAD]);
  writeFileSync(`${h.outDir}/sheet-full.png`, Buffer.from(report.png.split(',')[1], 'base64'));
  return { clear: report.clear, lums: report.lums };
}
