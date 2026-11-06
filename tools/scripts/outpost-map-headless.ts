// The Outpost's proof sheet on real Rapier and the real Player, with no browser:
//   nice -n 19 npx tsx tools/scripts/outpost-map-headless.ts [sections, comma list: build,static,parkour,sweep,fuzz] [fuzz seconds]
// Geometry and movement are the same code the game runs. Pictures still need tools/shot.mjs.
import type { Ctx } from '../../src/core/contracts';
import { createHeadlessGame } from '../../src/player/testkit/headless';

const globals = globalThis as unknown as Record<string, unknown>;
globals.location = { search: '?map=outpost' };
// Canvas painting only feeds textures and the minimap image, which nothing here looks at.
const paint: unknown = new Proxy({}, {
  get: (_, key) => (key === 'measureText' ? () => ({ width: 100 }) : () => undefined),
  set: () => true,
});
globals.document = { createElement: () => ({ getContext: () => paint, style: {}, width: 0, height: 0 }) };

const { World } = await import('../../src/world/World');
const proof = await import('../../src/world/map/outpost/proof');

const sections = new Set((process.argv[2] ?? 'build,static,parkour').split(','));
const game = await createHeadlessGame(() => {});
const world = new World(game.ctx);
(game.ctx as Ctx).world = world;
await world.build();
const out: Record<string, unknown> = {};
if (sections.has('build')) out.build = world.report;
if (sections.has('static')) out.static = proof.verifyOutpost(world, game.ctx.physics);
const rig = proof.rigOf(game);
if (sections.has('parkour')) out.parkour = proof.provePark(world, game.ctx.physics, rig);
if (sections.has('sweep')) out.sweep = proof.sweepOutpost(world, game.ctx.physics, rig);
if (sections.has('fuzz')) out.fuzz = proof.fuzzOutpost(rig, Number(process.argv[3] ?? 16));
console.log(JSON.stringify(out, null, 1));
