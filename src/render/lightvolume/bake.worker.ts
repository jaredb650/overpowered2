import { runBake, type BakeJob } from './bakeCore';

self.onmessage = (e: MessageEvent<BakeJob>) => {
  const result = runBake(e.data, fraction => {
    (self as unknown as Worker).postMessage({ progress: fraction });
  });
  (self as unknown as Worker).postMessage({ result }, result.textures.map(t => t.buffer));
};
