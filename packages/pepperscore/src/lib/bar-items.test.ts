import { describe, expect, it } from 'vitest';
import { resolveBar, BAR_HEADER_ID, BAR_CONTROL_GROUP } from './bar-items';
import { resolveChrome } from './chrome';
import { BAR_ITEM_IDS } from './skin';

describe('skin bar resolution', () => {
  it('preserves default headers and ignores bars on none', () => {
    expect(resolveBar(undefined, 'full')).toBeNull();
    expect(resolveBar({}, 'minimal')).toBeNull();
    expect(resolveBar({ bar: ['play'] }, 'none')).toBeNull();
    expect(resolveBar({ bar: [] }, 'full')).toEqual([]);
  });
  it('keeps requested order, removes unknown ids and duplicates', () => {
    expect(resolveBar({ bar: ['counts', 'play', 'counts', 'future', 'tempo'] } as never, 'minimal')).toEqual(['counts', 'play', 'tempo']);
  });
  it('maps private header names and honours every explicit false group', () => {
    expect(BAR_HEADER_ID.tempo).toBe('bpm');
    expect(BAR_HEADER_ID.viewToggle).toBe('mode');
    expect(BAR_HEADER_ID.zoom).toBe('staveScale');
    for (const id of BAR_ITEM_IDS) {
      const group = BAR_CONTROL_GROUP[id];
      expect(resolveBar({ bar: [id] }, 'minimal', group ? { [group]: false } : {})).toEqual(group ? [] : [id]);
    }
  });
  it('raises flags on minimal and mounts a bar even without transport', () => {
    const chrome = resolveChrome('minimal', {}, ['options', 'instrumentSwitch', 'zoom', 'tab']);
    expect(chrome).toMatchObject({ header: true, compactPlay: false, drawer: true, instrumentSwitch: true, zoom: true, tabToggle: true, transport: false });
    expect(resolveChrome('minimal', {}, ['play']).transport).toBe(true);
    expect(resolveChrome('minimal', { transport: false }, ['play']).transport).toBe(false);
    expect(resolveChrome('minimal', {}, []).header).toBe(false);
    expect(resolveChrome('minimal', {}, []).compactPlay).toBe(false);
  });
  it('does not raise any flags or audio on none', () => {
    expect(resolveChrome('none', {}, ['play', 'options'])).toEqual(resolveChrome('none'));
    expect(resolveChrome('full')).toMatchObject({ header: true, drawer: true, compactPlay: false });
    expect(resolveChrome('minimal')).toMatchObject({ header: false, compactPlay: true });
  });
});
