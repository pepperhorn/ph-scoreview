import { threeQuarterNotesDoc } from '../../test-helpers';
import { createEditorStore } from '../store';
import { extendSelection, moveCursor, setEntryMode } from './cursor';
import { setCursor, setSelection } from './score';

test('moveCursor selects the event it lands on in select mode, and nothing in entry mode', () => {
  const store = createEditorStore(threeQuarterNotesDoc());
  store.dispatch(setSelection, { ids: ['e1'] }, { record: false });
  store.dispatch(moveCursor, { by: 'event', delta: 2 }, { record: false });
  expect(store.getState().selection.ids).toEqual(['e3']);
  store.dispatch(setEntryMode, { mode: 'enter' }, { record: false });
  store.dispatch(moveCursor, { by: 'event', delta: -1 }, { record: false });
  expect(store.getState().selection.ids).toEqual([]);
  expect(store.getState().history.past).toEqual([]);
});

test('extendSelection anchors on a selected note’s event and selects the run to the head', () => {
  const store = createEditorStore(threeQuarterNotesDoc());
  store.dispatch(setCursor, { tick: 960 }, { record: false });
  store.dispatch(setSelection, { ids: ['n2'] }, { record: false });
  store.dispatch(extendSelection, { delta: 2 }, { record: false });
  expect(store.getState().selection.ids).toEqual(['e2', 'e3', 'e4']);
  store.dispatch(extendSelection, { delta: -3 }, { record: false });
  expect(store.getState().selection.ids).toEqual(['e2', 'e1']);
});
