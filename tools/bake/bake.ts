#!/usr/bin/env tsx
/**
 * Offline character pipeline: SDF edit list -> surface nets -> meshopt -> skin weights -> stump caps -> binary.
 *
 *   npx tsx tools/bake/bake.ts                bakes every archetype and prop at full quality
 *   npx tsx tools/bake/bake.ts husk trooper   bakes the named models
 *   npx tsx tools/bake/bake.ts husk --draft   coarse voxels and a small atlas, for iterating on a shape
 *   npx tsx tools/bake/bake.ts --list
 */
import { ARCHETYPES, archetypeById, unitRigFor, type ArchetypeDef } from '../../src/characters/archetypes';
import type { CapRef, ModelMeta, SectionName, SkeletonBone, Socket } from '../../src/characters/format';
import { buildCaps, type JointCaps } from './caps';
import { compact, fieldNormals, lodIndices, meshNormals, ready, simplify } from './meshops';
import { Field, Model } from './model';
import { occlusion } from './ao';
import { polygonize } from './polygonize';
import { computeSkin } from './skin';
import { bakeAtlas, unwrap } from './atlas';
import { OUT_DIR, writeModel } from './write';
import { Sk } from './parts/skeleton';
import { BUILDERS } from './archetypes/index';
import { PROPS, type PropDef } from './props';

interface Quality {
  /** Voxel edge in meters at modelling scale. */
  voxel: number;
  atlas: number;
  tris: number;
}

const b8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

function bakeSurface(edits: Model['edits'], voxel: number, targetTris: number, attrWeight: number) {
  const geo = edits.filter(e => !e.detail);
  const t0 = Date.now();
  const raw = polygonize(geo, voxel);
  const coarse = new Field(geo);
  const t1 = Date.now();
  const idx = simplify(raw, meshNormals(raw), targetTris, attrWeight);
  const c = compact({ positions: raw.positions, indices: idx });
  // The gradient is only worth paying for on the vertices that survive.
  const normals = fieldNormals(coarse, c.mesh.positions, voxel * 1.2);
  console.log(`  surface: ${(raw.indices.length / 3) | 0} -> ${(c.mesh.indices.length / 3) | 0} tris, ${c.mesh.positions.length / 3} verts (${t1 - t0} ms mesh, ${Date.now() - t1} ms simplify)`);
  return { mesh: c.mesh, normals, coarse };
}

/** Per-vertex paint and AO. These stay in the file as the fallback for models without an atlas and for AO. */
function paintVertices(field: Field, positions: Float32Array, normals: Float32Array, q = 1) {
  const nv = positions.length / 3;
  const colors = new Uint8Array(nv * 4);
  const materials = new Uint8Array(nv * 4);
  const s = { r: 0, g: 0, b: 0, rough: 0, metal: 0, emissive: 0, detail: 0, wear: 0 };
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    field.material(x, y, z, s);
    colors[v * 4] = b8(s.r); colors[v * 4 + 1] = b8(s.g); colors[v * 4 + 2] = b8(s.b);
    colors[v * 4 + 3] = b8(occlusion(field, x, y, z, normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!, q));
    materials[v * 4] = b8(s.rough); materials[v * 4 + 1] = b8(s.metal); materials[v * 4 + 2] = b8(s.emissive); materials[v * 4 + 3] = s.detail;
  }
  return { colors, materials };
}

function indexArray(a: Uint32Array, wide: boolean): Uint16Array | Uint32Array {
  return wide ? a : Uint16Array.from(a);
}

function bounds(p: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k]!, p[i + k]!);
    max[k] = Math.max(max[k]!, p[i + k]!);
  }
  return { min: min as unknown as [number, number, number], max: max as unknown as [number, number, number] };
}

async function bakeCharacter(def: ArchetypeDef, q: Quality): Promise<void> {
  const t0 = Date.now();
  console.log(`${def.id}:`);
  const rig = unitRigFor(def);
  const sk = new Sk(rig);
  const model = new Model();
  const sockets = BUILDERS[def.id]!(model, sk, def);
  console.log(`  ${model.edits.length} edits`);

  const target = Math.round(def.tris * q.tris);
  const { mesh, normals, coarse } = bakeSurface(model.edits, q.voxel, target, 0.5);
  const fine = new Field(model.edits);
  const skin = computeSkin(coarse, rig, sk, mesh.positions, mesh.indices);
  const paint = paintVertices(fine, mesh.positions, normals);
  const caps: JointCaps[] = buildCaps(coarse, rig, sk, def.stumps);

  // Seams split vertices, so unwrap comes after anything computed on the welded mesh.
  const labels = new Uint8Array(mesh.positions.length / 3);
  for (let v = 0; v < labels.length; v++) labels[v] = skin.index[v * 4]!;
  const unwrapped = q.atlas > 0 ? unwrap(mesh, q.atlas, labels) : null;
  const remap = unwrapped?.remap ?? null;
  const bodyVerts = remap ? remap.length : mesh.positions.length / 3;
  const capVerts = caps.reduce((n, c) => n + (c.parentSide.positions.length + c.childSide.positions.length) / 3, 0);
  const nv = bodyVerts + capVerts;

  const position = new Float32Array(nv * 3);
  const normal = new Int8Array(nv * 4);
  const color = new Uint8Array(nv * 4);
  const material = new Uint8Array(nv * 4);
  const uv = new Uint16Array(nv * 2);
  const skinIndex = new Uint8Array(nv * 4);
  const skinWeight = new Uint8Array(nv * 4);
  const s = def.proportions.scale;

  for (let v = 0; v < bodyVerts; v++) {
    const o = remap ? remap[v]! : v;
    for (let k = 0; k < 3; k++) {
      position[v * 3 + k] = mesh.positions[o * 3 + k]! * s;
      normal[v * 4 + k] = Math.round(normals[o * 3 + k]! * 127);
    }
    for (let k = 0; k < 4; k++) {
      color[v * 4 + k] = paint.colors[o * 4 + k]!;
      material[v * 4 + k] = paint.materials[o * 4 + k]!;
      skinIndex[v * 4 + k] = skin.index[o * 4 + k]!;
      skinWeight[v * 4 + k] = skin.weight[o * 4 + k]!;
    }
    if (unwrapped) {
      material[v * 4 + 3] |= 4;
      uv[v * 2] = unwrapped.uv[v * 2]!;
      uv[v * 2 + 1] = unwrapped.uv[v * 2 + 1]!;
    }
  }

  const skeleton: SkeletonBone[] = rig.bones.map((b, i) => ({
    name: b.name, parent: b.parent, pos: [sk.pos[i]![0] * s, sk.pos[i]![1] * s, sk.pos[i]![2] * s],
  }));
  const capRefs: CapRef[] = [];
  const capIdx: number[] = [];
  let cursor = bodyVerts;
  const placeCap = (c: JointCaps['parentSide'], boneIdx: number) => {
    const n = c.positions.length / 3;
    const base = cursor;
    for (let v = 0; v < n; v++) {
      const d = base + v;
      for (let k = 0; k < 3; k++) {
        position[d * 3 + k] = c.positions[v * 3 + k]! * s;
        normal[d * 4 + k] = Math.round(c.normals[v * 3 + k]! * 127);
      }
      for (let k = 0; k < 4; k++) {
        color[d * 4 + k] = c.colors[v * 4 + k]!;
        material[d * 4 + k] = c.materials[v * 4 + k]!;
      }
      skinIndex[d * 4] = boneIdx;
      skinWeight[d * 4] = 255;
    }
    cursor += n;
    return { base, indices: c.indices };
  };

  const finalBodyIndices = unwrapped ? unwrapped.indices : mesh.indices;
  const subtree = (b: number) => {
    const set = new Set<number>([b]);
    rig.bones.forEach((x, i) => { if (set.has(x.parent)) set.add(i); });
    return set;
  };
  const chainIdx: number[] = [];
  for (const c of caps) {
    const j = rig.bones[c.bone]!;
    const parentCap = skeleton.length;
    skeleton.push({ name: `cap.${j.name}.parent`, parent: j.parent, pos: skeleton[c.bone]!.pos });
    const childCap = skeleton.length;
    skeleton.push({ name: `cap.${j.name}.child`, parent: c.bone, pos: skeleton[c.bone]!.pos });
    const start = capIdx.length;
    const a = placeCap(c.parentSide, parentCap);
    for (const i of a.indices) capIdx.push(i + a.base);
    const childStart = capIdx.length;
    const b = placeCap(c.childSide, childCap);
    for (const i of b.indices) capIdx.push(i + b.base);

    const chain = subtree(c.bone);
    const chainStart = chainIdx.length;
    for (let t = 0; t < finalBodyIndices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        if (chain.has(skinIndex[finalBodyIndices[t + k]! * 4]!)) {
          chainIdx.push(finalBodyIndices[t]!, finalBodyIndices[t + 1]!, finalBodyIndices[t + 2]!);
          break;
        }
      }
    }
    for (let i = childStart; i < capIdx.length; i++) chainIdx.push(capIdx[i]!);
    capRefs.push({ bone: c.bone, parentCap, childCap, start, count: capIdx.length - start, chainStart, chainCount: chainIdx.length - chainStart });
  }

  const wide = nv > 65535;
  // LOD 1 keeps the atlas, so it has to respect UV seams. LOD 2 is simplified on the welded mesh, which can
  // go much lower, and is drawn with the vertex-colour material where seams do not matter.
  const lod1 = lodIndices(finalBodyIndices, position.subarray(0, bodyVerts * 3), Math.round(target * 0.42));
  const weldedLod = lodIndices(mesh.indices, mesh.positions, Math.round(target * 0.14));
  const lod2 = new Uint32Array(weldedLod.length);
  if (remap) {
    const firstCopy = new Int32Array(mesh.positions.length / 3).fill(-1);
    for (let i = 0; i < remap.length; i++) if (firstCopy[remap[i]!]! < 0) firstCopy[remap[i]!] = i;
    for (let i = 0; i < lod2.length; i++) lod2[i] = firstCopy[weldedLod[i]!]!;
  } else lod2.set(weldedLod);

  let atlas: ModelMeta['atlas'] = null;
  if (unwrapped) {
    atlas = await bakeAtlas(def.id, fine, coarse, { ...unwrapped, positions: mesh.positions, normals, size: q.atlas, voxel: q.voxel });
  }

  const sections: Partial<Record<SectionName, ArrayBufferView>> = {
    position, normal, color, material,
    ...(unwrapped ? { uv } : {}),
    skinIndex, skinWeight,
    lod0: indexArray(finalBodyIndices, wide),
    lod1: indexArray(lod1, wide),
    lod2: indexArray(lod2, wide),
    caps: indexArray(Uint32Array.from(capIdx), wide),
    chains: indexArray(Uint32Array.from(chainIdx), wide),
  };
  const scaled: Record<string, Socket> = {};
  for (const [name, sock] of Object.entries(sockets)) {
    scaled[name] = { ...sock, pos: [sock.pos[0] * s, sock.pos[1] * s, sock.pos[2] * s] };
  }
  const meta: Omit<ModelMeta, 'sections'> = {
    id: def.id, kind: 'character', vertexCount: nv, skeleton, rigBoneCount: rig.bones.length, caps: capRefs,
    sockets: scaled, wideIndex: wide, bounds: bounds(position.subarray(0, bodyVerts * 3)), atlas,
    accent: def.accent, triangles: finalBodyIndices.length / 3,
  };
  const bytes = writeModel(meta, sections);
  console.log(`  ${finalBodyIndices.length / 3} tris (lod1 ${lod1.length / 3}, lod2 ${lod2.length / 3}), ${capIdx.length / 3} cap tris, ${nv} verts, ${(bytes / 1024) | 0} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function bakeProp(id: string, def: PropDef, q: Quality): Promise<void> {
  const t0 = Date.now();
  console.log(`prop ${id}:`);
  const model = new Model();
  const sockets = def.build(model);
  const voxel = q.voxel * (def.voxelScale ?? 0.7);
  const target = Math.round(def.tris * q.tris);
  const { mesh, normals, coarse } = bakeSurface(model.edits, voxel, target, 0.7);
  const fine = new Field(model.edits);
  const paint = paintVertices(fine, mesh.positions, normals, 0.5);
  const atlasSize = Math.min(q.atlas, def.atlas ?? 512);
  const unwrapped = q.atlas > 0 ? unwrap(mesh, atlasSize) : null;
  const remap = unwrapped?.remap ?? null;
  const nv = remap ? remap.length : mesh.positions.length / 3;
  const position = new Float32Array(nv * 3);
  const normal = new Int8Array(nv * 4);
  const color = new Uint8Array(nv * 4);
  const material = new Uint8Array(nv * 4);
  const uv = new Uint16Array(nv * 2);
  const sc = def.scale ?? 1;
  for (let v = 0; v < nv; v++) {
    const o = remap ? remap[v]! : v;
    for (let k = 0; k < 3; k++) {
      position[v * 3 + k] = mesh.positions[o * 3 + k]! * sc;
      normal[v * 4 + k] = Math.round(normals[o * 3 + k]! * 127);
    }
    for (let k = 0; k < 4; k++) {
      color[v * 4 + k] = paint.colors[o * 4 + k]!;
      material[v * 4 + k] = paint.materials[o * 4 + k]!;
    }
    if (unwrapped) {
      material[v * 4 + 3] |= 4;
      uv[v * 2] = unwrapped.uv[v * 2]!;
      uv[v * 2 + 1] = unwrapped.uv[v * 2 + 1]!;
    }
  }
  const finalIdx = unwrapped ? unwrapped.indices : mesh.indices;
  const wide = nv > 65535;
  let atlas: ModelMeta['atlas'] = null;
  if (unwrapped) {
    atlas = await bakeAtlas(id, fine, coarse, { ...unwrapped, positions: mesh.positions, normals, size: atlasSize, voxel });
  }
  const lod1 = lodIndices(finalIdx, position, Math.round(target * 0.3));
  const scaled: Record<string, Socket> = {};
  for (const [name, sock] of Object.entries(sockets)) scaled[name] = { ...sock, pos: [sock.pos[0] * sc, sock.pos[1] * sc, sock.pos[2] * sc] };
  const meta: Omit<ModelMeta, 'sections'> = {
    id, kind: 'prop', vertexCount: nv, skeleton: [], rigBoneCount: 0, caps: [], sockets: scaled, wideIndex: wide,
    bounds: bounds(position), atlas, accent: def.accent ?? [1, 1, 1], triangles: finalIdx.length / 3,
  };
  const bytes = writeModel(meta, {
    position, normal, color, material, ...(unwrapped ? { uv } : {}),
    lod0: indexArray(finalIdx, wide), lod1: indexArray(lod1, wide),
  });
  console.log(`  ${finalIdx.length / 3} tris, ${nv} verts, ${(bytes / 1024) | 0} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log([...ARCHETYPES.map(a => a.id), ...Object.keys(PROPS)].join('\n'));
    return;
  }
  const draft = args.includes('--draft');
  const noAtlas = args.includes('--no-atlas');
  const names = args.filter(a => !a.startsWith('--'));
  const q: Quality = draft
    ? { voxel: 0.0095, atlas: noAtlas ? 0 : 512, tris: 0.7 }
    : { voxel: 0.0052, atlas: noAtlas ? 0 : 1024, tris: 1 };
  await ready();
  const ids = names.length ? names : [...ARCHETYPES.map(a => a.id), ...Object.keys(PROPS)];
  const t0 = Date.now();
  for (const id of ids) {
    if (PROPS[id]) await bakeProp(id, PROPS[id]!, q);
    else await bakeCharacter(archetypeById(id), q);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${OUT_DIR}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
