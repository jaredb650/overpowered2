/**
 * Stand-in for a system that is not loaded, used by sandboxes.
 * Every property read returns another no-op, and every call returns undefined-like no-ops,
 * so a sandbox can run one real system with the rest stubbed out.
 */
export function noop<T extends object>(label = 'stub'): T {
  const fn = () => undefined;
  const handler: ProxyHandler<() => undefined> = {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => label;
      if (prop === 'then') return undefined;
      return noop(`${label}.${String(prop)}`);
    },
    apply() {
      return undefined;
    },
    set() {
      return true;
    },
  };
  return new Proxy(fn, handler) as unknown as T;
}
