import { deleteMeasure, insertMeasure } from '../engine/commands/index';
import { useDispatch, useUi } from './controls';
import { Icon } from './icons';
import type { CanvasGeometry } from './useCanvasGeometry';
import { useEditorStore } from './useEditorStore';

const SIZE = 22;
const GAP = 6;

/**
 * Add and remove a bar at the end of the score, stacked at the right edge of the last drawn bar (kept inside
 * the visible stage when that bar is scrolled away).
 */
export function AddBarButtons({ geometry }: { geometry: CanvasGeometry }) {
  const { store, editable } = useUi();
  const dispatch = useDispatch();
  const measures = useEditorStore(store, (s) => s.document.global.measures);
  const { last, viewport } = geometry;
  if (!last || !editable) return null;
  const height = SIZE * 2 + GAP;
  const fitsRight = last.right + 8 + SIZE <= viewport.right - 4;
  const left = Math.max(4, Math.min(fitsRight ? last.right + 8 : last.right - SIZE - 6, viewport.right - SIZE - 4));
  const top = Math.max(4, Math.min(last.top + last.height / 2 - height / 2, viewport.bottom - height - 4));
  const lastId = measures[measures.length - 1]?.id ?? null;
  return (
    <div className="ps-add-bar" style={{ left, top }}>
      <button type="button" className="ps-btn ps-add-bar-btn" title="Add a bar at the end" aria-label="Add bar" onClick={() => dispatch(insertMeasure, { afterMeasureId: lastId })}>
        <Icon name="plus" size={13} />
      </button>
      <button type="button" className="ps-btn ps-add-bar-btn ps-remove-bar-btn" title="Remove the last bar" aria-label="Remove bar" disabled={measures.length <= 1} onClick={() => lastId && dispatch(deleteMeasure, { measureId: lastId })}>
        <Icon name="minus" size={13} />
      </button>
    </div>
  );
}
