import { describe, expect, it } from 'vitest';
import { breakLines } from './fit';
import { buildViewMei } from '../notation/mei-view';
import { PAPER_SIZES } from './paper';

describe('PDF line fitting', () => {
  it('shortens only the dense bar line, leaving following sparse lines at four', () => {
    expect(breakLines([20,20,20,20,95,20,20,20,20,20,20,20,20],100,4)).toEqual([0,4,5,9]);
  });
  it('handles empty, single, exact and oversize bars', () => {
    expect(breakLines([],100,4)).toEqual([]);
    expect(breakLines([100],100,4)).toEqual([0]);
    expect(breakLines([101,20,20,20,20],100,4)).toEqual([0,1]);
    expect(breakLines([25,25,25,25,25],100,4)).toEqual([0,4]);
    expect(() => breakLines([NaN],100,4)).toThrow();
    expect(() => breakLines([1],0,4)).toThrow();
    expect(() => breakLines([1],100,0)).toThrow();
  });
  it('models all four paper sizes as millimetres', () => {
    expect(PAPER_SIZES).toEqual({a4:{width:210,height:297},a3:{width:297,height:420},letter:{width:215.9,height:279.4},legal:{width:215.9,height:355.6}});
  });
});
const mei = '<mei><music><section><measure xml:id="a"/><ending n="1"><measure xml:id="b"/><measure xml:id="c"/></ending><measure xml:id="d"/></section></music></mei>';
const view = { breakEvery: 2, hiddenStaves: [], chordSymbols: true };
it('keeps the legacy output byte-identical when breakBefore is absent', () => {
  expect(buildViewMei(mei,view)).toBe(mei.replace('<measure xml:id="c"/>','<pb/><measure xml:id="c"/>'));
});
it('replaces periodic page breaks with explicit system breaks before wrappers', () => {
  expect(buildViewMei(mei,{...view,breakBefore:[0,1,3]})).toBe(mei.replace('<ending','<sb/><ending').replace('<measure xml:id="d"/>','<sb/><measure xml:id="d"/>'));
  expect(buildViewMei(mei,{...view,breakBefore:[]})).toBe(mei);
  expect(buildViewMei(mei,{...view,breakBefore:[11]},Infinity,10)).toBe(mei.replace('<ending','<sb/><ending'));
});
