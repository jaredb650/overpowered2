# Renderer

`src/render/`. Entry point: `createRenderSystem(canvas)` from `src/render/index.ts`. Showcase: `/?sandbox=render`.

## Frame

One `render()` call runs these in order.

| Step | Target | Notes |
|---|---|---|
| Moon shadows | depth maps | Static map only when dirty. Dynamic map every frame, moving casters only |
| Viewmodel opaque | scene, MSAA | Drawn first, squeezed into depth range 0..0.02 |
| World opaque + sky | scene, MSAA | Same target and depth buffer. One resolve for both |
| Depth copy | `depthTexture` | Published here, so soft particles and decals can read this frame's depth |
| Decals | resolved scene colour | Before AO and fog, so both apply to them |
| Half-res depth, GTAO, fog march + temporal, SSR | half-res targets | All driven by depth |
| Combine | HDR | AO multiply, SSR, fog, with depth-aware upsample |
| World transparent, viewmodel transparent | HDR | Single-sampled, against the world depth. FX sit on top of the fog |
| Bloom | R11G11B10 pyramid | Threshold 1.1, soft knee |
| Composite | canvas | Radial blur, CA, Khronos PBR Neutral, grade, low health, damage, speed lines, vignette, grain, dither |

Opaque and transparent are split by wrapping `sort()` on three's cached render list (`Renderer.hookRenderList`). Any object with `material.transparent` lands in the right pass with no opt-in. `material.transmission` is drawn as plain alpha, because a transmission pass would need the opaque list.

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

**Reset.** The renderer listens for `run:start` and clears decals, flashes and post state itself.

## API additions

On `LightVolumeBakeInput` in `contracts.ts`: `voxelSize?`. The rest live on the `Renderer` class, not on `RenderSystem`, so cast to reach them:

| Member | Use |
|---|---|
| `fog` | Live `FogSettings`: density, heightFalloff, baseHeight, noise, bakedGain, moonGain, anisotropy, maxDistance. Safe to change per zone |
| `passes` | `{ ao, fog, bloom, shadows, decals, ssr }` booleans |
| `moon` | The world's directional light. Colour changes also need `opMoonColor` |
| `volume` | `LightVolume`: `stats`, `skyZenith`, `skyHorizon`, `bounce` |
| `dynamicResolution` | `.enabled`, `.scale` |
| `measurePasses()` | Isolated GPU cost of each post pass |
| `refreshStaticShadows()` | Re-render the static map once |
| `renderSize()` | Internal size after quality and dynamic resolution |

## Tuning

- `quality.ts`: one row per preset: MSAA, resolution, AO, fog steps, bloom levels, shadow sizes, SSR steps, light count.
- `post/grades.ts`: every grade as plain numbers.
- `materials/surfaces.glsl.ts`: every material. `MaterialLibrary.ts` holds tile size, bump, wetness and macro variation.
- `materials/decalAtlas.glsl.ts`: every decal.
- `Sky.ts`: sky shader. `LightVolume.skyZenith` and `skyHorizon` should follow it if the sky is regraded, because the bake does not read the shader.
- `engine.ts`: `opAmbientFloor` is the least irradiance anywhere. Raise it if dark areas hurt readability.
- Moon direction and intensity: `Renderer` constructor.

## Measured cost

`measurePasses()` at 1920x1080, quality 2, on the real map. Other agents kept the machine loaded the whole time (load average 25-35), so each figure is the best of six rounds, and the two final runs still disagree by up to 0.5 ms.

| Pass | Run 1 | Run 2 |
|---|---|---|
| Fog march + temporal | 1.54 | 2.09 |
| Combine | 1.36 | 1.25 |
| Bloom | 1.10 | 0.84 |
| AO + blur | 0.96 | 0.80 |
| SSR | 0.65 | 0.59 |
| Composite | 0.24 | 0.24 |
| Half-res depth | 0.19 | 0.15 |
| **Total** | **6.04** | **5.95** |

**That is about 1 ms over the 5 ms budget as measured.** The best figure per pass sums to 5.4 ms. I could not get an uncontended number, so I do not know the true cost on an idle M1. The MSAA resolve and the depth copy are not in this table. If the budget has to be met for certain, quality 1 removes SSR and drops AO to one slice.

The sandbox hall measures 3.8 ms at 1280x720.

Light bake on the real map, measured at 200 x 40 x 200 cells with 272 lights: about 5 s in a worker while nav builds on the main thread, plus 0.6 s of sliced `isSolid` sampling. The cap has since gone to 48 cells high, which should add about 20%. That larger size has not been timed separately.

GPU memory at 1080p quality 2 is about 430 MB. That is calculated, not measured: scene and depth MSAA 100 MB, other full-res targets 50 MB, half-res targets and bloom 30 MB, material sets 140 MB, decal atlas 44 MB, light volume 60 MB, shadows 60 MB.

## Known limitations

- **Timer queries are useless here.** Under ANGLE on Metal each one read about 6 ms whatever the pass did. That is why `measurePasses()` syncs instead, and why dynamic resolution follows the frame interval. As a result a CPU-bound frame also drops resolution, which does not help it.
- **Dynamic resolution is off under automation** (`navigator.webdriver`) so screenshots stay stable. I forced it on with artificial 26 ms frames: it stepped down to 0.62 and began climbing back to 0.70 once the load stopped, with no errors. It has not been tried in a real play session. Each step reallocates the render targets and will hitch briefly.
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
