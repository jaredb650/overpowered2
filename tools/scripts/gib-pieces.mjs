// Close-ups of every piece a body breaks into, for judging the models: laid out in rows in front of the player's eye on
// the Test Range, under the game's own light, each turned a little more than the last so both faces show.
//
//   GIB_SET=slabs node tools/shot.mjs --port <yours> --url "/?map=range" --script tools/scripts/gib-pieces.mjs \
//     --dpr 2 --w 1440 --h 900 --wait 500 --timeout 240 --quiet --out tools/out/<you>/pieces-slabs.png
//
//   GIB_SET   slabs (each slab twice: skin up, meat up) | trunk (the six-piece crack) | limbs (each limb's four parts) | loose (organs, ribs, meat, head kit,
//             and the parts of a destroyed limb) | all
//   GIB_ID    the archetype (default trooper)
//   GIB_TURN  radians every piece is turned about the vertical (default 0), for a second angle
// Prints each piece's size and volume.
const SET = process.env.GIB_SET ?? 'slabs';
const ID = process.env.GIB_ID ?? 'trooper';
const TURN = Number(process.env.GIB_TURN ?? 0);

export default async function gibPieces(page, h) {
  for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => !!window.__lab && window.__op2?.game?.state === 'playing')) break;
    await h.sleep(500);
  }
  const report = await page.evaluate(async ({ SET, ID, TURN }) => {
    const lab = window.__lab;
    const { ctx } = window.__op2;
    const V = ctx.player.position.constructor;
    lab.settings.progression = false;
    lab.flags.progression = false;
    lab.settings.overlay = false;
    ctx.player.modifiers.invulnerable = true;
    ctx.render.viewScene.visible = false;
    const canvas = document.querySelector('canvas');
    for (const el of document.body.children) if (!el.contains(canvas)) el.style.visibility = 'hidden';
    for (const el of canvas.parentElement.children) if (el !== canvas) el.style.visibility = 'hidden';
    const frame = () => new Promise(r => requestAnimationFrame(r));
    ctx.enemies.killAll('lab');
    ctx.enemies.reset();
    lab.spawner.clearBodies();
    ctx.player.teleport(new V(0, 0.1, 6), 0);
    await frame();
    const gore = ctx.gore;
    const e = lab.spawner.place(ID, new V(14, 0, 30), 'off');
    await frame();
    const kit = gore.kitFor(e.char);
    const skin = e.char.skinMaterial;
    const flesh = gore.sliced.flesh;
    const scene = ctx.render.scene;
    const anyMesh = gore.chunks.meshes.get('meat');
    const Mesh = Object.getPrototypeOf(Object.getPrototypeOf(anyMesh)).constructor;
    const eye = ctx.player.eye.clone();
    const items = [];
    const litres = g => {
      // Signed volume of a closed mesh.
      const p = g.getAttribute('position').array;
      const idx = g.getIndex().array;
      let v = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
      }
      return Math.abs(v) * 1000;
    };
    const add = (name, geometry, material, flip, scale = 1) => items.push({ name, geometry, material, flip, scale });
    if (SET === 'slabs' || SET === 'all') {
      kit.slabs.forEach((s, i) => add(`slab ${i} skin`, s.geometry, [skin, flesh], false));
      kit.slabs.forEach((s, i) => add(`slab ${i} meat`, s.geometry, [skin, flesh], true));
    }
    if (SET === 'trunk' || SET === 'all') {
      kit.crack6.forEach((p, i) => add(`trunk ${i}`, p.side.geometry, [skin, flesh], false));
      kit.crack6.forEach((p, i) => add(`trunk ${i} back`, p.side.geometry, [skin, flesh], true));
    }
    if (SET === 'limbs' || SET === 'all') {
      (kit.limbs ?? []).forEach((parts, li) => parts.forEach((p, k) => add(`limb ${li} part ${k}`, p.side.geometry, [skin, flesh], k % 2 === 1)));
    }
    if (SET === 'loose' || SET === 'all') {
      for (const [kind, mesh] of gore.chunks.meshes) {
        if (kind.startsWith('slab:') || kind === 'scrap') continue;
        const size = { meat: 0.08, viscera: 0.07, bone: 0.05, cranium: 0.11, jaw: 0.11, brain: 0.11, eye: 0.11 }[kind] ?? (gore.organSize?.(kind) ?? 1);
        add(kind, mesh.geometry, mesh.material, false, size);
      }
    }
    const cols = Math.min(6, Math.ceil(Math.sqrt(items.length * 1.6)));
    const rows = Math.ceil(items.length / cols);
    const out = [];
    const made = [];
    items.forEach((it, k) => {
      const m = new Mesh(it.geometry, it.material);
      it.geometry.computeBoundingBox();
      const size = it.geometry.boundingBox.getSize(new V()).multiplyScalar(it.scale);
      const col = k % cols, row = Math.floor(k / cols);
      const gap = 0.36;
      m.position.set(eye.x + (col - (cols - 1) / 2) * gap, eye.y + ((rows - 1) / 2 - row) * 0.36, eye.z - 0.85);
      m.scale.setScalar(it.scale);
      m.rotation.set(it.flip ? 0.25 : -0.2, (it.flip ? Math.PI : 0) + 0.45 + TURN, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      made.push(m);
      out.push({ name: it.name, cm: [size.x, size.y, size.z].map(v => +(v * 100).toFixed(1)), litres: +(litres(it.geometry) * it.scale ** 3).toFixed(2) });
    });
    ctx.player.yaw = 0;
    ctx.player.pitch = 0;
    if (lab.paused) lab.togglePause();
    for (let i = 0; i < 30; i++) await frame();
    lab.togglePause();
    await frame();
    return { archetype: ID, kitMs: +kit.ms.toFixed(1), limbMs: +(gore.limbMs ?? 0).toFixed(1), slabs: kit.slabs.map(s => ({ litres: +s.litres.toFixed(2), half: s.half.toArray().map(v => +v.toFixed(3)) })), pieces: out };
  }, { SET, ID, TURN });
  await h.sleep(300);
  return report;
}
