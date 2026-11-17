import { classifyError, type ErrorCode } from './errors';
import { report, type ReportDetail } from './report';

type Sink = (code: ErrorCode, detail?: ReportDetail) => void;
let fatalHandler: ((code: ErrorCode, error: unknown) => void) | undefined;
const isFatal = (code: ErrorCode) => code === 'OUT_OF_MEMORY' || code === 'WEBGL_CONTEXT_LOST' || code === 'WEBGL_UNAVAILABLE';
/** Failures are isolated per system, not around the whole frame. Retry next frame; report each system only once. */
export function createFrameGuard(sink: Sink = report) {
  const failed = new Set<string>();
  return (name: string, update: () => void): void => {
    try { update(); }
    catch (error) {
      if (!failed.has(name)) {
        failed.add(name);
        try {
          const code = classifyError(error);
          sink(code, { error, stage: name });
          if (isFatal(code)) fatalHandler?.(code, error);
        } catch { /* keep ticking */ }
      }
    }
  };
}
export function installGlobalCapture(fatal: (code: ErrorCode, error: unknown) => void, target: Window = window, sink: Sink = report): () => void {
  fatalHandler = fatal;
  const capture = (error: unknown, stage: string) => {
    const code = classifyError(error); sink(code, { error, stage });
    if (isFatal(code)) fatal(code, error);
  };
  const onError = (event: ErrorEvent) => { capture(event.error ?? event.message, 'global'); };
  const onRejection = (event: PromiseRejectionEvent) => { capture(event.reason, 'promise'); };
  const onContext = (event: Event) => {
    event.preventDefault();
    sink('WEBGL_CONTEXT_LOST', { stage: 'canvas' });
    fatal('WEBGL_CONTEXT_LOST', new Error('WebGL context lost'));
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  target.document.addEventListener('webglcontextlost', onContext, { capture: true });
  return () => {
    if (fatalHandler === fatal) fatalHandler = undefined;
    target.removeEventListener('error', onError); target.removeEventListener('unhandledrejection', onRejection);
    target.document.removeEventListener('webglcontextlost', onContext, { capture: true });
  };
}
