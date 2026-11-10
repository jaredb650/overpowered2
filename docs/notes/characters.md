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
c.wound({ kind, bone, point, dir, radius, depth, ragged });  // cuts the body itself. See Wounds below
c.addWound(bone, worldPoint, 0.04);           // paint only: blood and bruising
c.fracture(bone, 'hyper');                    // snaps the joint at the top of this bone. 'limp' for a shoulder or hip
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
| `Character.wound(hit)`, `SeveredLimb.wound(hit)` | Damages the body. Most callers want `ctx.gore.wound`, which picks the wounds for a hit |
| `Character.fracture(bone, style, skew?)`, `isFractured(bone)` | Broken limbs. See Wounds below |
| `Character.skinMaterial` | What a world-space copy of the body is drawn with. `bakePose` output cannot use the wounded program |
| `Character.stress` | Per bone, hits that broke nothing yet. Gore reads and writes it |
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
- `getUp(kind, seconds, hurt, startU)` takes over from whatever is on the bones and blends out of it over 0.42 s. The last 16% fades into ordinary standing, which has been posed underneath all along. A body with no legs has no clip: it blends 0.7 s into its crawl. With `startU` (0..1) the clip starts that far in and plays the rest over `seconds`, blending in over 0.25 s: gore's struggle has already pushed the body up on straight arms (0.24, before the knees come under) or sat it up (0.3).
- `poseGetUpStart(kind, hips)` writes the first frame onto the bones for gore to read joint targets from, and `poseGetUpAt(kind, u, hips, flip)` any frame; the clip that follows keeps that `flip`, its lead side, which is otherwise mirrored at random.
- `keepAboveFloor` lifts the hips if a blend or an odd body shape would put a low joint through the floor. It is there because a blend knows nothing about the floor, and the keys were made on a Trooper.
- A gun hand hugs the weapon in and the other arm does the pushing.

## Rendering

- One `MeshStandardMaterial` per model plus a far variant. All instances share it. Four programs cover the whole cast.
- Per-instance state rides in spare texels at the end of the instance's bone texture: 32 wounds, blood, burn,
  frost, flash. No per-object uniforms and no extra draw state. The texture is 16 x 16 for every rig, which spares each
  fetch an integer divide. 37 bones and 32 wounds take 246 of its 256 texels.
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

## Wounds

`src/characters/anatomy/`. What is left on a body short of losing a limb. What a hit leaves is decided in `gore/wounds.ts`: see `docs/notes/gore.md`.

| File | Job |
|---|---|
| `wounds.ts` | `WoundBook`: the list on one body, in the bone texture. Merging. Pure data, tested in Node |
| `glsl.ts` | The maths the skin, the inside and the backing share |
| `build.ts` | `buildInterior`: what is under the skin, fitted to the baked mesh at load |
| `interior.ts` | Its material |
| `backing.ts` | The inside of the skin: the far wall of the body, and an opened body's shadow |
| `fracture.ts` | `FracturePose`: broken joints on a body still being animated |

**A wound is a slot, not a sphere.** Hit capsules only roughly follow the skin. A small sphere at the hit point cuts nothing when the skin lies under it. A slot along the shot's own line is right sideways by construction, and its depth is forgiving, so nothing on the CPU has to find the skin. A gash is the same slot with length. It measures square to its axis, so it follows a curved body when its two ends are a chord across it. Kinds are in `WoundKind`: hole, exit, crater, gash, burn, graze, dent.

**Draws.**

| Body | Skin | Extra |
|---|---|---|
| Healthy | `a.material`. No wound code at all | None |
| Paint only (burn, graze, dent) | `a.woundMaterial` | None |
| Opened, LOD 0 | `a.woundMaterial`, no longer casts | Interior and backing, one draw each. Backing also replaces the skin in the shadow pass |
| Opened, LOD 1 | The same | Backing only. The hole is a few pixels of dark |
| LOD 2 and past | `a.farMaterial`: no wounds drawn | None |

Corpses keep their LOD up to date through `Gore.updateBodyLod`, one body a frame, because nothing else sets it after death.

**Under the skin**, deepest last: inner body (trunk lofted through the skin's own cross-sections, sleeves round the limbs, a mass at each joint), rib cage, spine, pelvis, skull, long bones, lungs, heart, liver, stomach, bowel. About 9k triangles per archetype, shared. Each layer is removed in the middle of a wound by how deep it went, so a bullet shows flesh, a cannon shows ribs and lungs, and only a crater 7.5 cm deep breaks bone.

**What has to stay true.**

- **Everything inside is cut away except under a wound.** It does not fit the skin exactly and does not have to, but take that test out and it pokes through everywhere.
- **The far wall is not a shrunk copy of the skin.** Pulling a surface in along its normals turns thin gear inside out, and it comes through the far side as black spikes. Backing is the skin's own geometry, back faces only. It also has to be the same LOD as the skin: the lower LODs stick out past it at silhouettes.
- **Do not make the skin double-sided.** It is what the backing replaced: a third more shading for a whole body, 1.1 ms over 20. `discard` alone measured 0.3 ms.
- **The skin's own program cannot draw into the moon's map.** It samples that map, and WebGL drops the draw as a feedback loop. Hence `backing.ts`, with `material.allowOverride = false`, which three's scene override respects. `isOrthographic` tells the two passes apart, because the moon is the only orthographic camera a body sees.
- **`aEdge` is why holes appear on flat plates.** Whether a wound is near is worked out per vertex and interpolated, and on a plate all three corners of a triangle can be far from a hole in its middle. Each vertex adds the longest edge touching it to its reach, which is enough to never miss one. Before it, stains stopped in straight lines along triangles.
- **Reach comes first.** The first texel of a wound holds its centre and how far any trace of it reaches, so almost every pixel and vertex skips a wound on one fetch.
- **The skin's slot depth does not follow the wound's depth.** It only says where the skin can be. Tied to depth, a 12 cm exit reached through to the front of the chest.
- **The wall of a small hole is drawn on the skin.** Flesh lies centimetres behind gear, and through a 2 cm hole most angles see past it to the dark. The last of the skin inside the tear is shaded as meat falling away, and only the middle is discarded.
- **Channel g of the detail texture is cloth weave.** Used on anything else it looks like a bandage.

**Merging.** A new wound that overlaps one already there grows it, by area, up to a limit for that bone, and digs it deeper. A hole that reaches 3 cm becomes a crater. So sustained fire takes a chunk out with no special case. With all 32 slots in use the faintest paint goes first, then the two closest wounds merge. A new wound always lands. The two sides of a limb lie close in bind space, so wounds facing opposite ways do not merge.

**Regions.** In the A-pose an arm lies inside a chest wound's slot. Each wound carries which parts it may touch, as bits, and each vertex belongs to one part by its heaviest bone. Near a shoulder or hip a wound takes in both.

**Fractures.** `fracture(bone, 'hyper')` bends a hinge past straight, the wrong way: `bone` is the forearm for an elbow, the shin for a knee. `'limp'` kills a ball joint, with the hinge below it hanging slack. A verlet point on the end of the limb swings by its own weight from wherever the joint is carried, after the animator has run, by wrapping `anim.update`, so it holds through every animator. In a ragdoll the joint opens instead: `Rag.breakJoint`, and `JointMuscle.broken` takes the muscles off it. Bone ends are parts of the interior that stay collapsed to a point until the bit for their joint is set.

Warm-up: `CharacterLibraryImpl.warmWounds` draws one wounded body out of sight on the first frame, so the first hit of a game compiles nothing. Measured: program count 95 before and after the first wound, and that frame's `render()` took 2.2 ms.

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

Cost of 20 troopers at 5 to 13 m, all at LOD 0, over the same frame with them hidden. `tools/scripts/wound-bench.mjs`, Test Range, `--dpr 2 --w 1440 --h 900`, frozen frames timed round-robin with a GPU sync at each end, best of 8 rounds. The empty frame is 6.5 ms. It was 7.9 ms for the old build, on a busier machine and before the render agent's latest work, so compare the differences and not the totals.

| 20 bodies, each with | Old build | Now |
|---|---|---|
| Nothing | +2.4 ms | +2.25 ms |
| 8 wounds of paint | +3.0 ms | +3.4 ms |
| 16 wounds of paint | +3.2 ms | +3.4 ms |
| 16 paint, 8 real holes | Not possible | +5.5 ms |
| The same, chest and belly open | Not possible | +6.05 ms |

Every body opened at once at close range is the worst case, about 0.19 ms per opened body. 1.13M triangles against 0.69M, and 172 draws against 132.

Wounds are in the middle of `render()` with the rest of the frame, so these are whole-frame figures. Timer queries read nothing useful here: see `docs/notes/render.md`.

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

## Checks

```
WG_SCENES=bullets,shotgun WG_TYPE=trooper node tools/shot.mjs --url "/?map=range" --dpr 2 --w 1440 --h 900 --wait 500 --timeout 150 \
  --quiet --script tools/scripts/wound-gallery.mjs --out tools/out/wounds.png
node tools/shot.mjs --url "/?map=range" --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --quiet --script tools/scripts/wound-bench.mjs --out tools/out/wb.png
```

Gallery scenes: `warm bullets shotgun blast belly cannon sword burn scorch fracture limb corpse`, and on request `healthy types machines live shadow under`. `live` fires real weapons with real keys. `under` hides the skin to show what a wound reaches. `shadow` writes two pictures that differ by a hole's light on the floor.

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
- **A sliced half loses its wounds.** `bakePose` is world space and has no bones, so it draws with the plain skin. Slicing a damaged body gives clean halves.
- **Wounds are at most a slot deep.** There is no real volume: from the side, the far wall of a hole in a thin limb is a dark surface rather than a tunnel.
- **Bone breaks at a joint.** There are no bones in the middle of a limb, so a forearm snaps at the elbow. A shaft through the side of the arm is a spike, not a bend.
- **Broken legs still walk.** `maim.legs` drops to 1, which stops jumps and dodges, but the animator's gait comes from the severed set. A body with a snapped knee walks on with the shin swinging free, and there is no hop.
- **A gun stays in a broken hand.** The prop follows the hand down. The AI stops using it.
- **Armour plates are separate meshes.** Wounds go on the skin under them, and a plate that is still on hides what is there.
- `grounded` in `LocomotionInput` is read as "feet on the ground". Its comment in `contracts.ts` talks about crawling,
  which actually happens by itself from the severed set.
