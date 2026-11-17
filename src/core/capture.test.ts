import { describe, expect, it, vi } from 'vitest';
import { createFrameGuard, installGlobalCapture } from './capture';

describe('global capture and frame isolation', () => {
  it('a throwing system cannot stop later systems or the next frame; only reports once', () => {
    const sink = vi.fn(); const guard = createFrameGuard(sink); const later = vi.fn();
    for (let frame = 0; frame < 3; frame++) { guard('bad-effect', () => { throw new Error('effect'); }); guard('hud', later); }
    expect(later).toHaveBeenCalledTimes(3); expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toBe('UNCAUGHT_EXCEPTION');
  });
  it('captures uncaught errors and promise rejections without throwing, and displays lost-context recovery', () => {
    const target = new EventTarget() as Window;
    Object.assign(target, { document: new EventTarget() });
    const fatal = vi.fn(); const sink = vi.fn(); const remove = installGlobalCapture(fatal, target, sink);
    expect(() => target.dispatchEvent(Object.assign(new Event('error'), { error: Error('boom') }))).not.toThrow();
    expect(() => target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: Error('boom') }))).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0]![0]).toBe('UNCAUGHT_EXCEPTION');
    const lost = new Event('webglcontextlost', { cancelable: true }); target.document.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true); expect(fatal).toHaveBeenCalledWith('WEBGL_CONTEXT_LOST', expect.any(Error));
    remove(); target.document.dispatchEvent(new Event('webglcontextlost')); expect(fatal).toHaveBeenCalledTimes(1);
  });
});
