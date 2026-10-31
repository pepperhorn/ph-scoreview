import { describe, expect, it, vi } from 'vitest';
import { BAR_ITEM_IDS, CRF_PITCH_COLOURS, mergeSkins, skinKey, skinStyle, tokenVariable, warnInvalidTheme } from './skin';
import type { PepperScoreSkin } from './skin';

describe('plain-data skins', () => {
  it('merges maps and replaces bars without aliasing inputs', () => {
    const base: PepperScoreSkin = { theme: { accent: 'red', surface: 'white' }, pitchColours: CRF_PITCH_COLOURS, bar: ['play', 'tempo'] };
    const merged = mergeSkins(base, { theme: { accent: 'blue' }, pitchColours: { C: 'pink' }, bar: [] });
    expect(merged.theme).toEqual({ accent: 'blue', surface: 'white' });
    expect(merged.pitchColours).toEqual({ ...CRF_PITCH_COLOURS, C: 'pink' });
    expect(merged.bar).toEqual([]);
    merged.theme!.surface = 'black';
    expect(base.theme!.surface).toBe('white');
    expect(mergeSkins({})).toEqual({});
    expect(mergeSkins(base, {})).toEqual(base);
  });
  it('has stable keys for reordered maps, but respects bar order', () => {
    expect(skinKey({ theme: { accent: 'red', surface: 'white' } })).toBe(skinKey({ theme: { surface: 'white', accent: 'red' } }));
    expect(skinKey({ bar: ['play', 'stop'] })).not.toBe(skinKey({ bar: ['stop', 'play'] }));
    expect(skinKey()).toBe(skinKey({}));
  });
  it('warns on invalid resolved host colours, without rejecting valid CSS', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'not-a-colour' }));
    vi.stubGlobal('CSS', { supports: (_property: string, value: string) => value === 'red' });
    try {
      warnInvalidTheme({} as HTMLElement, { theme: { accent: 'var(--broken-host)' } });
      expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Invalid theme colour for accent'));
      warn.mockClear();
      vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'red' }));
      warnInvalidTheme({} as HTMLElement, { theme: { accent: 'var(--valid-host)' } });
      expect(warn).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); warn.mockRestore(); }
  });
  it('maps role names to variables and only applies theme in T1', () => {
    expect(tokenVariable('focusRing')).toBe('--ps-focus-ring');
    expect(skinStyle({ theme: { accent: 'var(--brand)' }, bar: ['play'], pitchColours: CRF_PITCH_COLOURS })).toEqual({ '--ps-accent': 'var(--brand)' });
    expect(skinStyle()).toEqual({});
    expect(skinStyle({ theme: { typo: 'red' } } as PepperScoreSkin)).toEqual({});
    expect(BAR_ITEM_IDS).toContain('pdf');
    expect(Object.values(CRF_PITCH_COLOURS)).toEqual(['#f86e6e', '#f58841', '#ffbc57', '#b8a334', '#fff56d', '#b3f888', '#93d154', '#6bc6a0', '#7ee8df', '#88a7f8', '#cc97e8', '#e277b1']);
  });
});
