/** Serialises a baked model to the shared binary format. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MODEL_MAGIC, MODEL_VERSION, type Manifest, type ModelMeta, type SectionName } from '../../src/characters/format';

export const OUT_DIR = 'public/assets/characters';

export function writeModel(meta: Omit<ModelMeta, 'sections'>, sections: Partial<Record<SectionName, ArrayBufferView>>): number {
  const refs: ModelMeta['sections'] = {};
  let offset = 0;
  const parts: { off: number; view: ArrayBufferView }[] = [];
  for (const [name, view] of Object.entries(sections) as [SectionName, ArrayBufferView][]) {
    refs[name] = { offset, bytes: view.byteLength };
    parts.push({ off: offset, view });
    offset += (view.byteLength + 3) & ~3;
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...meta, sections: refs }));
  const jsonPad = (json.length + 3) & ~3;
  const head = 12 + jsonPad;
  const buf = new Uint8Array(head + offset);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, MODEL_MAGIC, true);
  dv.setUint32(4, MODEL_VERSION, true);
  dv.setUint32(8, jsonPad, true);
  buf.set(json, 12);
  buf.fill(0x20, 12 + json.length, head);
  for (const p of parts) buf.set(new Uint8Array(p.view.buffer, p.view.byteOffset, p.view.byteLength), head + p.off);
  const file = join(OUT_DIR, `${meta.id}.bin`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);

  const mf = join(OUT_DIR, 'manifest.json');
  const manifest: Manifest = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : { version: MODEL_VERSION, models: {} };
  manifest.version = MODEL_VERSION;
  manifest.models[meta.id] = { file: `${meta.id}.bin`, bytes: buf.length, triangles: meta.triangles, kind: meta.kind };
  writeFileSync(mf, JSON.stringify(manifest, null, 1));
  return buf.length;
}
