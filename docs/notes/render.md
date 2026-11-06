# Renderer

`src/render/`. Entry point: `createRenderSystem(canvas)` from `src/render/index.ts`. Showcase: `/?sandbox=render`.

## Frame

One `render()` call runs these in order.

| Step | Target | Notes |
|---|---|---|
| Moon shadows | depth maps | Static map only when dirty. Dynamic map every frame, moving casters only |
| Viewmodel opaque | scene | Drawn first, squeezed into depth range 0..0.02 |
| World opaque + sky | scene | Same target and depth buffer. One resolve for both when the preset has MSAA |
| Depth copy | `depthTexture` | Published here, so soft particles and decals can read this frame's depth |
| Decals | resolved scene colour | Before AO and fog, so both apply to them |
| Half-res depth, GTAO, fog march + temporal, SSR | half-res targets | All driven by depth |
| Combine | HDR | AO multiply, SSR, fog, with depth-aware upsample |
| World transparent, viewmodel transparent | HDR | Single-sampled, against the world depth. FX sit on top of the fog |
| Bloom | R11G11B10 pyramid | Threshold 1.1, soft knee |
| Composite | canvas | Edge AA and sharpen when the preset has no MSAA, radial blur, CA, Khronos PBR Neutral, grade, low health, damage, speed lines, vignette, grain, dither |

Opaque and transparent are split by wrapping `sort()` on three's cached render list (`Renderer.hookRenderList`). Any object with `material.transparent` lands in the right pass with no opt-in. `material.transmission` is drawn as plain alpha, because a transmission pass would need the opaque list.

**Resolution.** The canvas is the preset's pixel budget, not the screen. `maxPixels` is a ceiling: the canvas takes the largest stretch of the screen from 1, 1.5, 2, 3 or 4 device pixels per canvas pixel that fits, and the page compositor does the stretch. Only those ratios are allowed. At 1.8x the bilinear stretch sharpens and softens in a repeating pattern that grain and wet floors show as a faint grid.

**Dynamic resolution** renders into the bottom-left corner of targets allocated at full size. The viewport of each target is the area in use, and `readArea()` in `fullscreen.ts` gives a pass the uv scale for it and the last uv a bilinear tap can use without reading stale pixels. A step only sets viewports and uniforms. Fog history and SSR read last frame's image with last frame's area, so a step does not restart them. `gl_FragCoord`-based reads, including the fx layers' `gl_FragCoord / uDepthRes`, work unchanged because the area starts at texel zero.

**Edge AA** runs inside Composite from one set of five taps: FXAA across real edges, luma sharpen everywhere else. It folds HDR into 0..1 first, because a raw blend of a 9x emissive strip and a dark wall still tone-maps to white. With no MSAA a neon strip thinner than a pixel breaks into dashes, so `EmissiveLines` draws each emissive mesh's edges in its own colour as GL lines, which rasterise unbroken.

The viewmodel shares the world's depth buffer instead of clearing it. Depth under 0.02 means viewmodel, and AO, fog and SSR skip those pixels. To keep the multisampled colour alive between the two `render()` calls, the target's `samples` is set to 0 for the first call. Both this and the list hook depend on three r187 internals, so re-check them when upgrading three.

## Using it

```ts
const render = await createRenderSystem(canvas);
render.init(ctx);                     // Game does this
render.scene.add(mesh);
await render.bakeLightVolume({ bounds, lights, isSolid, voxelSize: 1.5 });
render.render();                      // once per frame, after the camera is placed
```

**Materials**

- `materials.world(name)` needs no UVs. Textures are projected from world position, so scaled boxes tile at true size. The texture sets are baked on the GPU at load.
- `materials.patch(m)` adds the light volume, moon shadow, reflection occlusion and baked specular to any `MeshStandardMaterial` or `MeshPhysicalMaterial`. Skinned and instanced meshes work, and so does the viewmodel scene. It composes with `onBeforeCompile` set before or after the call (tested in both orders). Keep the standard `#include` lines intact. A missing anchor logs `[render] patch: anchor ... missing`.
- Do not use `world()` materials on things that move in the world. The projection is world-locked, so the texture slides. The viewmodel scene is handled: it projects in eye space.
- Unpatched standard materials still render, with moonlight, dynamic lights and sky reflection but no volume light and no shadows.

**Lights.** `lights.flash` and `BakedLight` use three's units: irradiance is `intensity / distance²`, faded to zero at `radius`. Flashes peak on the first frame and decay with the square of the remaining time, on world time. Up to 64 requests are held, and the brightest at the camera get real lights. They also light the fog.

**Shadows.** `castShadow = true` is all a mesh needs. Everything casting at the time of `bakeLightVolume()` goes in the static map, except skinned meshes and meshes with `userData.dynamicShadow = true`. **Set that flag on anything built before the bake that later moves**, such as crushers and doors, or its shadow stays behind. Anything added later is dynamic. Dynamic shadows reach 34 m from the camera. Call `refreshStaticShadows()` after changing static geometry.

**Decals.** `decals.add(kind, point, normal, size, rotation)`. `size` is the full quad edge in meters. For `bloodSmear` and `slash`, rotation sets the drag direction along local +X. Pools grow over about a second. Decals test depth in the shader, so nothing z-fights or overhangs a ledge. They do not wrap around corners: the part past a corner is cut off.

**Post.** All `PostFx` methods run on real time, so effects decay through hit-stop and pause. `chromatic()` saturates, so anything from 0.01 to over 1 is safe.

**Reset.** The renderer listens for `run:start` and clears decals, flashes, post state and the x-ray itself.

**X-ray.** `render.highlight(meshes, color, strength)` draws meshes as flat silhouettes through whatever is in front of them. It is immediate: a call lasts one rendered frame, so call it every frame the meshes should show. That is what makes it safe around pooled characters, because nothing can stay lit after a body is released, and a frame with no call costs one branch. Pass `char.mesh`, or any mesh: skinned, plain and instanced all work. Up to four calls a frame, one extra walk of the scene each. Calling with different colours is fine. Helicopter gunners should just call it from their update with the enemy meshes.

Hidden pixels get the fill and a bright edge, and pixels in plain sight only an edge, so wounds stay readable. The pass blends by max, so overlapping limbs stay one flat shape in any draw order. It tests against `depthCopy` by hand rather than with the depth buffer, because hidden means behind the world but not behind the gun, and the fixed depth test can say one of those at most.

`render.sweep(origin, color, speed, reach)` is one ring at a time, running over every surface in view from depth. Only the world's surfaces show it, so open sky does not. Both run after the transparent pass and before bloom.

## API additions

On `LightVolumeBakeInput` in `contracts.ts`: `voxelSize?`. The rest live on the `Renderer` class, not on `RenderSystem`, so cast to reach them:

| Member | Use |
|---|---|
| `fog` | Live `FogSettings`: density, heightFalloff, baseHeight, noise, bakedGain, moonGain, anisotropy, maxDistance. Safe to change per zone |
| `passes` | `{ ao, fog, bloom, shadows, decals, ssr }` booleans |
| `moon` | The world's directional light. Colour changes also need `opMoonColor` |
| `volume` | `LightVolume`: `stats`, `skyZenith`, `skyHorizon`, `bounce` |
| `dynamicResolution` | `.enabled`, `.scale`. `?drs=1` forces it on under automation, `?drs=0` off |
| `measurePasses()` | Isolated GPU cost of each post pass |
| `refreshStaticShadows()` | Re-render the static map once |
| `renderSize()` | Internal size after quality and dynamic resolution |

## Tuning

- `quality.ts`: one row per preset: MSAA, pixel budget, AO, fog steps, bloom levels, shadow sizes, SSR steps, light count. Index 2 is the default, and saved settings point at it, so retune that row rather than moving the default.
- `post/grades.ts`: every grade as plain numbers.
- `XRay.ts`: silhouette and ring shaders. `HIDDEN_BIAS` is how far behind the depth buffer a body must be to count as hidden.
- `materials/surfaces.glsl.ts`: every material. `MaterialLibrary.ts` holds tile size, bump, wetness and macro variation.
- `materials/decalAtlas.glsl.ts`: every decal.
- `Sky.ts`: sky shader. `LightVolume.skyZenith` and `skyHorizon` should follow it if the sky is regraded, because the bake does not read the shader.
- `engine.ts`: `opAmbientFloor` is the least irradiance anywhere. Raise it if dark areas hurt readability.
- Moon direction and intensity: `Renderer` constructor.

## Measured cost

`tools/scripts/gpu-bench.mjs` measures all of this in the real game at `--dpr 2 --w 1440 --h 900`: frame throughput with one thing changed at a time, run round-robin, and each stage on its own between GPU syncs.

Whole frame at a fixed spot with eight enemies on screen, in ms. Before was 1920x1200 with 4x MSAA. After is the default on this display: 1440x900, no MSAA. The before figures were taken at load average 15 to 30 and the after figures at 3 to 9, so read it as about 3x, not as exact.

| | Kill House | Crucible |
|---|---|---|
| Before, best / median | 28.9 / 34 | not taken |
| After, best / median | 7.5 to 7.8 / 8.0 to 8.3 | 9.5 to 9.9 / 9.7 to 9.9 |

What the before frame was made of, at the Kill House:

| Change | Saved |
|---|---|
| 4x MSAA off | 8 to 10, of which the resolve is 5 to 6 |
| World shaders replaced by one colour, MSAA off | 8.5 to 11 |
| Internal size to 49% of the pixels, MSAA off | 8 to 9 |
| AO, fog, SSR and bloom all off, MSAA off | 5 to 6.5 |

Inside the world shader: shadow lookups 2.7 to 4, the three extra light volume fetches and their evaluation 1.8 to 3.4, and eight unrolled point lights up to 2.9 with no light lit. Wetness, macro variation, the sky reflection, the dominant-light specular and anisotropy measured nothing, so texture fetches are not the cost.

`measurePasses()` at the default, best of six, with the 2.3 megapixel figures from before:

| Pass | Before | After |
|---|---|---|
| Fog march + temporal | 1.37 | 0.67 to 1.03 |
| Combine | 1.45 | 0.67 to 0.70 |
| Bloom | 1.10 | 0.68 to 0.77 |
| AO + blur | 0.97 | 0.70 to 0.93 |
| SSR | 0.72 | 0.28 to 0.33 |
| Composite | 0.27 | 0.25 to 0.32 |
| Half-res depth | 0.22 | 0.12 to 0.13 |
| **Total** | **6.09** | **3.7 to 3.9** |

Composite now holds edge AA, which is why it did not fall. Whole-frame toggles at the default show each of AO, SSR, fog and bloom worth 0.1 to 0.5 ms, shadows 0.5 to 0.9, and world shading 3.3 to 4.8, so the post stack has nothing large left in it.

**A fight.** Eighteen husks at 5 to 14 m, firing, about 2.7M triangles and 350 to 460 draws, frozen and timed the same way: 12.3 to 13.7 ms at the Kill House, 13.6 to 15.6 at the Crucible. At 1600x1000 the Crucible was 16.6 to 17, which is why the default is not that size. Dynamic shadows cost about 1 ms of that frame, and drawing them from LOD 1 or 2 changed nothing measurable, so a shadow LOD is not worth building.

Live frame intervals in the same fight, dynamic resolution off, measured at low priority under other agents' load:

| | p50 | p90 | p99 | Frames over 20 ms |
|---|---|---|---|---|
| Kill House | 16.7 | 16.7 | 16.8 to 33.4 | 0.7% to 5.8% |
| Crucible | 16.7 | 16.8 to 33.3 | 33.4 | 8% to 15% |
| Crucible, dynamic resolution on | 16.7 | 16.7 | 33.4 | 5.7% |

**The misses left at the Crucible are on the main thread, not the GPU.** There the JS frame is 16.2 ms at the median on frames that made it and 18.2 ms on frames that did not, with `render()` itself about 8.5 ms of that. Dynamic resolution went all the way to 0.62 in that fight without fixing it, then gave up, which agrees. This is at `nice 19`, so a normal-priority browser should do better, but I could not measure one. The budget in DESIGN.md is 12 ms.

Light bake on the real map, measured at 200 x 40 x 200 cells with 272 lights: about 5 s in a worker while nav builds on the main thread, plus 0.6 s of sliced `isSolid` sampling. The cap has since gone to 48 cells high, which should add about 20%. That larger size has not been timed separately.

GPU memory at the default is about 350 MB. That is calculated, not measured: full-res targets 32 MB, half-res targets and bloom 12 MB, material sets 140 MB, decal atlas 44 MB, light volume 60 MB, shadows 60 MB. It was about 430 MB at 1080p with MSAA.

## Known limitations

- **Timer queries are useless here.** Under ANGLE on Metal each one read about 6 ms whatever the pass did. That is why `measurePasses()` syncs instead, and why dynamic resolution follows the frame interval. As a result a CPU-bound frame also drops resolution. If the whole range does not beat the interval it started from, it returns to full size and rests for 30 s.
- **Dynamic resolution steps are free.** Ten forced steps in the real game loop: `render()` 1.9 to 2.5 ms on the step frame against 2.1 at the median and 2.7 at p99 around it, and the next interval 15.6 to 16.9 ms. The old reallocating step measured up to 28 ms against 9, on battery and under load, so only the direction of that comparison is safe. It has not been tried by a person in a real play session. With MSAA the resolve still covers the whole target, so a step saves less on Ultra.
- **The frame rate drops to 30 Hz on low battery.** With the laptop at 4% and discharging, a plain page with no canvas ran rAF at 33.3 ms in `tools/shot.mjs`. On AC the same runs went to 16.7 ms, and `render()` in a calm scene fell from 8.8 to 2 ms of CPU. The cause is probably the browser's energy saver, which I did not confirm. Any frame interval taken on battery says nothing about the game, and a player on battery is held at 30 fps whatever the GPU does.
- **Thin geometry at range is not antialiased on High.** Rails and cables break into dashes, gratings are noisier and small print on the viewmodel is softer. Emissive strips stay whole but read a little brighter at range and show small ticks at their ends. Ultra keeps 4x MSAA. Only stills were compared, so the shimmer of all this in motion has not been judged.
- **Light volume leaks.** Cells on the real map are about 1.75 m wide and 1.9 m tall. Thin walls can bleed light, and small rooms get soft light rather than crisp pools.
- **Only moon shafts are sharp,** because they use the shadow map. Coloured lights make soft haze at this cell size, not hard shafts. Close to a lamp the haze can show as a fuzzy ball.
- **Bounce light is a diffusion approximation,** not a real gather. It stays out of walls but is not energy-correct.
- **SSR is screen-space only.** Nothing off-screen reflects, so the forward reflection takes over at the screen edge. Normals come from depth, so normal maps do not perturb reflections. It samples last frame's image.
- **Gratings.** Shadows are solid, because the shadow pass ignores alpha. Far gratings go solid on purpose, to avoid moire, and some moire remains at middle distance. SSR skips them because their depth gives no usable normal.
- **Glass** only dims with distance. It gets no fog colour of its own.
- **Decals are depth-tested to about 3 cm,** so a foot touching a decal can show a sliver of it. They do not wrap corners.
- **Blood on a dry floor gets no SSR.** Decals leave the floor's reflectivity untouched, so its shine comes from forward specular only.
- **Bird's-eye views** show the sky's below-horizon band under the skyline. A player inside the map cannot see it.
- **Moon direction is fixed at construction.** Changing it after the static shadow bake needs `refreshStaticShadows()`, and the sky environment is not re-baked.
