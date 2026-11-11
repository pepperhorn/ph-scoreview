import { useEffect } from 'react';
import { setMeta, type EditorHost, type EditorPlugin } from '@pepperhorn/pepperscore-editor';

declare global {
  interface Window {
    __plugin: { host: EditorHost; mounts: number; unmounts: number; active: number; notifications: number; pulses: number };
  }
}

/** Validation-only overlay: no tour logic or copy is shipped in the editor package. */
function StubOverlay({ host }: { host: EditorHost }) {
  const probe = window.__plugin ??= { host, mounts: 0, unmounts: 0, active: 0, notifications: 0, pulses: 0 };
  probe.host = host;
  useEffect(() => {
    probe.mounts++;
    return () => { probe.unmounts++; };
  }, []);
  useEffect(() => {
    probe.active++;
    const off = host.subscribe(() => { probe.notifications++; });
    const pulse = () => { probe.pulses++; };
    window.addEventListener('ps-stub-pulse', pulse);
    return () => {
      probe.active--;
      off();
      window.removeEventListener('ps-stub-pulse', pulse);
    };
  }, [host]);
  return <>
    <div className="ps-stub-backdrop" hidden style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(0,0,0,.2)', pointerEvents: 'auto' }} />
    <aside className="ps-stub-plugin" aria-label="Plugin validation" style={{ position: 'absolute', top: 120, right: 20, zIndex: 100, background: 'white', padding: 8 }}>
      <input aria-label="Plugin input" />
      <button type="button" onClick={() => host.dispatch(setMeta, { project: 'Stub' })}>Plugin edit</button>
    </aside>
  </>;
}
export const editorStubPlugin: EditorPlugin = { id: 'validation-stub', apiVersion: 1, Overlay: StubOverlay };
