/**
 * Turns recipes into AudioBuffers. Rendering runs on OfflineAudioContext threads. The little JS
 * here only trims, normalizes and closes loop seams.
 */
import { clamp, mulberry32 } from '../../core/math';
import { Synth } from './dsl';
import type { Recipe } from './recipe';

/** Stable seed per id and variant, so a sound does not change between sessions. */
function seedOf(id: string, variant: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h ^ Math.imul(variant + 1, 2654435761)) >>> 0;
}

/** Equal-power crossfade of the render's tail back over its head, leaving exactly `length` samples. */
function closeLoop(channels: Float32Array[], length: number, seam: number): Float32Array[] {
  return channels.map(ch => {
    const out = ch.slice(0, length);
    for (let i = 0; i < seam; i++) {
      const t = (i + 0.5) / seam;
      out[i] = out[i]! * Math.sin(t * Math.PI * 0.5) + ch[length + i]! * Math.cos(t * Math.PI * 0.5);
    }
    return out;
  });
}

/** Scan for the last audible sample so a voice is not held for a silent tail. */
function audibleLength(channels: readonly Float32Array[], floor: number): number {
  for (let i = channels[0]!.length - 1; i >= 0; i--) {
    for (const ch of channels) if (Math.abs(ch[i]!) > floor) return i + 1;
  }
  return 1;
}

function finish(channels: Float32Array[], recipe: Recipe, sampleRate: number): Float32Array[] {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
  const gain = peak > 0 ? recipe.peak / peak : 1;
  let out = channels;
  if (!recipe.loop) {
    const length = Math.min(channels[0]!.length, audibleLength(channels, peak * 0.0004) + 1);
    out = channels.map(ch => ch.slice(0, length));
  }
  const length = out[0]!.length;
  const fade = recipe.loop ? 0 : Math.min(length >> 1, Math.floor(sampleRate * 0.006));
  for (const ch of out) {
    for (let i = 0; i < length; i++) ch[i] = ch[i]! * gain;
    for (let i = 0; i < fade; i++) ch[length - 1 - i] = ch[length - 1 - i]! * (i / fade);
  }
  return out;
}

export interface RawRender {
  channels: Float32Array[];
  rate: number;
}

/** Builds the graph and renders it on a browser thread. Only the build runs here. */
export async function startVariant(recipe: Recipe, variant: number, sampleRate: number): Promise<RawRender> {
  const rate = recipe.rate ?? sampleRate;
  const channels = recipe.stereo ? 2 : 1;
  const seamSamples = Math.floor(recipe.seam * rate);
  const length = Math.floor(recipe.dur * rate);
  const ctx = new OfflineAudioContext(channels, length + seamSamples, rate);
  recipe.build(new Synth(ctx, recipe.dur, mulberry32(seedOf(recipe.id, variant)), variant));
  const rendered = await ctx.startRendering();
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(rendered.getChannelData(c));
  return { channels: data, rate };
}

/** Closes the loop seam, trims and normalizes. Separate from rendering so it can wait for idle time. */
export function finishVariant(recipe: Recipe, raw: RawRender): AudioBuffer {
  const { rate } = raw;
  let data = raw.channels;
  if (recipe.loop) data = closeLoop(data, Math.floor(recipe.dur * rate), Math.floor(recipe.seam * rate));
  data = finish(data, recipe, rate);
  const out = new AudioBuffer({ length: data[0]!.length, numberOfChannels: data.length, sampleRate: rate });
  data.forEach((ch, c) => out.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  return out;
}

/** What a sound measures at trim 1. Close to a clean gunshot peaked at full level. */
const REFERENCE_LOUDNESS = 0.3;

/**
 * Multiplier that brings a sound to the reference loudness. Recipes normalize to peak, so without it a
 * sustained tone would land far louder than a gunshot at the same catalogue volume.
 */
export function trimFor(loud: number): number {
  return loud > 0 ? clamp(REFERENCE_LOUDNESS / loud, 0.2, 2.5) : 1;
}
