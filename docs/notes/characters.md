# Characters

Baked models, skinned instances and procedural animation. Everything is generated from code: `tools/bake/` turns
signed-distance edit lists into binary meshes and texture atlases, `src/characters/` plays them.

## Using it

```ts
await ctx.characters.load();                  // all archetypes, or load(['husk', 'trooper'])
const c = ctx.characters.spawn('trooper');    // pooled, already carrying its baked props
scene.add(c.root);
c.root.position.copy(p); c.root.rotation.y = yaw;

c.anim.setLocomotion(input);                  // every frame
c.anim.update(dt, lod);                       // lod 0 full rate, 1 half, 2+ quarter
c.setLod(lod);                                // geometry and material, 0..3

c.anim.play('attackMelee');                   // returns duration in seconds
c.anim.flinch(bone, worldDir, 0.5);           // additive, stacks
c.anim.stumble?.(worldDir, 0.7, bone);        // balance gone: quick steps, arms out, a shot leg buckles
c.anim.holdWound?.(bone, worldPoint, 1.2);    // a hand goes to it, and the body bends if it is low
c.anim.guard?.(0.6);                          // hands up to the face
c.anim.daze?.(1.5);                           // swaying, a hand to the head
c.addWound(bone, worldPoint, 0.04);           // sticks to the skin, 16 per body, oldest out
c.setBloodiness(0.4); c.hitFlash(1);
c.setBurn(0.7); c.setFrost(1);

const part = c.spawnSevered(bone);            // call before or after hideLimb, either works
c.hideLimb(bone);
const geo = c.bakePose();                     // world-space copy for slicing, caller owns it
c.release();
```

The animator measures velocity from `root.position`, so feet stay planted however the AI moves the root. `speed` and
`moveX/Z` from `setLocomotion` are only used when `anim.treadmill` is true. Set `grounded: false` for the airborne pose.

### Additions to the contract

| Member | Purpose |
|---|---|
| `Character.setBurn(0..1)`, `setFrost(0..1)` | Char with crawling embers, ice |
| `Character.setLod(level)` | Picks LOD geometry and the far material |
| `Character.muzzle` | Object3D on the weapon's muzzle, or null. More exact than hand position plus an offset |
| `Character.props` | `{ bone, object }` for everything attached, including baked backpacks and tanks |
| `Character.isHidden(bone)` | True once a bone has been cut away |
| `anim.onFootstep(x, y, z, strength)` | Each plant. Heavy archetypes (`weight >= 0.7`) default to camera trauma and dust |
| `anim.groundAt` | Foot height sampler, wired to `world.nav.groundHeight` |
| `anim.treadmill` | Previews: drive feet from input speed instead of root motion |
| `library.prop(id)` | A loose baked prop: `smg`, `shotgun`, `fuelTank`... For dropped weapons |
| `library.sockets(id)` | Named mount points of a model |
| `anim.setPosture(name)`, `anim.disarm()` | Soldier postures from `animation/postures.ts`: crouch, cover, lean, hands up, kneel, cower, flee, drag, revive, downed. `disarm` empties the hands until the pool resets the body |

`SeveredLimb` follows the gore dummy's contract: `root` sits at identity in the scene, `bones[bone]` holds the world
pose. Everything outside the chain is parented to that bone at near-zero scale, so skin blended into the parent closes
over the child cap. Props on the chain are cloned onto the limb, because a limb can outlive the instance that shed it.

### Reactions

`stumble` only poses. The root is the caller's: move it and the feet follow, at twice the cadence for that speed, with the body leaning ahead of them. From a stand the foot that has to catch goes at once. Walking, the gait is left alone, because jumping its phase jumps every limb on it.

`holdWound` is the wound hold section 14.6 asks for. Pass a long `seconds` and refresh it. It picks the free hand: never the arm that was hit, and the left if there is a gun.

None of these exist on skitters and drones, which is how gore and the enemies know not to ask.

### Getting up

`getUp.ts` is two clips, keys on a 1.85 m body: hips, spine, ankles, wrists. IK does the rest, so one clip fits every humanoid and a missing limb just is not solved. Lead side is mirrored at random.

- Face down: the head lies toward +Z. Press up, hands and knees, lead foot through, stand. Face up: the feet lie toward +Z. Sit up, hand behind, rock forward over the feet, stand. So the yaw comes from how the body lies, and nothing turns on the way up.
- `getUp(kind, seconds, hurt)` takes over from whatever is on the bones and blends out of it over 0.42 s. The last 16% fades into ordinary standing, which has been posed underneath all along. A body with no legs has no clip: it blends 0.7 s into its crawl.
- `keepAboveFloor` lifts the hips if a blend or an odd body shape would put a low joint through the floor. It is there because a blend knows nothing about the floor, and the keys were made on a Trooper.
- A gun hand hugs the weapon in and the other arm does the pushing.

## Rendering

- One `MeshStandardMaterial` per model plus a far variant. All instances share it. Four programs cover the whole cast.
- Per-instance state rides in spare texels at the end of the instance's bone texture: 16 wound spheres, blood, burn,
  frost, flash. No per-object uniforms and no extra draw state.
- Object-space normal atlas, rotated by the skin matrix in the vertex shader. No tangents, no tangent seams.
- Atlas A is sRGB albedo with metalness (alpha below 0.5) or emissive (above) packed in alpha. Atlas B is normal plus
  roughness.
- LOD 0 and 1 use the atlas. LOD 1 respects UV seams, so it only drops to about 40%. LOD 2 is simplified on the welded
  mesh to about 14% and paints from vertex colour with no micro detail.
- Stump caps are extra indices appended to a second geometry per LOD. A healthy body never draws them.
- Cap bones are outside the scene graph until shown, so they cost nothing on a healthy body.
- Hit flash fades in `mesh.onBeforeRender` from `ctx.time.elapsed`, so a corpse nobody updates still fades.
- Authored albedo goes through a lift curve in the shader, and `uFill` adds a floor under the baked light, because true
  albedo left gear pure black in the map's shadows. Both are readability choices, not physics.

## Measured

| Item | Number |
|---|---|
| Humanoid triangles | 12k to 14k, Juggernaut 22k, Titan 30k. Caps add 3k, only once a limb is off |
| LOD 1 / LOD 2 | About 42% and 14% of LOD 0 |
| Animation, 48 characters all at LOD 0 | 0.75 ms on a loaded M1, against a 2 ms budget, before LOD savings |
| 48 characters in the sandbox | 214 draw calls and 1.05M triangles including shadow passes |
| Disk | 37 MB for 16 characters and 13 props, about 2.2 MB per character |
| Atlas density | 2.1 to 2.8 mm per texel at 1024 |
| Foot slide | Under 2 cm at 2 to 11 m/s and at 30 to 144 Hz, asserted in `animation/gait.test.ts` |

## Baking

```
npx tsx tools/bake/bake.ts                 everything, about 20 minutes on a busy machine
npx tsx tools/bake/bake.ts husk trooper    named models
npx tsx tools/bake/bake.ts husk --draft    coarse voxels and a 512 atlas, about 15 s
npx tsx tools/bake/bake.ts --list
```

Pipeline: edit list, surface nets on a sparse octree, meshopt to budget, skin weights, stump caps, chart unwrap,
per-texel projection back onto the distance field. Output is `public/assets/characters/<id>.bin`, `<id>.a.png`,
`<id>.n.png`, plus `manifest.json`.

A model is an ordered list of `add`, `cut` and `paint` edits. Order matters: a cut only affects what came before it.
Edits marked `detail` are skipped by the polygonizer and only reach the texture, so rivets, grooves and stitches cost
no triangles. `m.snapshot()` freezes the body so far as a shape; `conform`, `padOn`, `plate`, `suit` and `groove` use
it to make equipment fit the body beneath.

Adding an archetype: an entry in `src/characters/archetypes.ts`, a builder in `tools/bake/archetypes/`, a line in
`STYLES` for how it moves. Props go in `tools/bake/props.ts`, authored with the grip at the origin and the barrel along
+Z.

## Tuning

| Where | Knob |
|---|---|
| `animation/styles.ts` | Per-archetype hunch, crouch, cadence, stance width, arm spread, bounce, twitch |
| `archetypes.ts` | Scale, bulk, reach, accent colour, triangle budget, `weight` (0 nimble, 1 ground-shaking), stance |
| `HumanoidAnimator.ts` | `LAND_LEAD`, stance fraction, `DURATION` per action, key curves in `poseBody` and `actionHand` |
| `material.ts` | `uRim` readability rim, `uEmissive` accent strength, burn and wound shader |
| `bake.ts` `Quality` | Voxel size, atlas size, triangle scale |
| `skin.ts` `BLEND` | Joint blend width per bone |

## Sandbox

`/?sandbox=models` is the line-up. Add `&archetype=<id>&view=front|three|side|back|close|face|feet`,
`&anim=idle|run|<AnimAction>&speed=<m/s>`, `&cut=armL,legR,head&bake=1`, `&blood=`, `&burn=`, `&frost=`, `&wounds=1`,
or `&bench=48` for a crowd. `window.__m` gives frame-stepped control.

`tools/bake/capture.mjs` drives contact-sheet captures through `tools/shot.mjs`, with `CAPTURE`, `VIEWS`, `GAIT`,
`ACTIONS` and `MAIM` in the environment. `tools/bake/sheet.mjs` tiles the results into one image.

## Known limitations

- No finger, jaw or twist bones. Hands are baked into a pose per archetype, and a large forearm twist candy-wraps at
  the wrist.
- Long cloth (gunner's coat, warden's robe, ghillie strips) is skinned to the hips or chest, not simulated. Strides
  push through the panels at high speed.
- The Juggernaut and the Titan share the pauldron and cuirass kit and look more related than the brief wants.
- Atlas chart seams can show a one-texel smear on bright emissive edges.
- `bakePose` only outputs LOD 0, and normal-map rotation there is per vertex, so a cut piece's detail shading is a
  close approximation at joints.
- The animator does not avoid obstacles or other bodies. Arms clip through props in extreme aim angles past about
  70 degrees of yaw.
- `grounded` in `LocomotionInput` is read as "feet on the ground". Its comment in `contracts.ts` talks about crawling,
  which actually happens by itself from the severed set.
