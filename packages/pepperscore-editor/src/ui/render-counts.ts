/**
 * Render counts per shell component, a probe for tests (validation/editor.mjs reads it through the demo's
 * `window.__editor.renderCounts`): a cursor move must not re-render the shell around the score.
 */
export const renderCounts: Record<string, number> = {};
export const countRender = (name: string): void => {
  renderCounts[name] = (renderCounts[name] ?? 0) + 1;
};
