import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../instruments';
import { applyOverrides, joinRuns, planShifts, tieChainOf, type FitEvent } from './range-fit-core';

const alto = INSTRUMENTS['alto-saxophone'];
const range = alto.ranges!.intermediate;
const ev = (id: string, ...midi: number[]): FitEvent => ({ id, midi });
const mid = Math.round((range.low + range.high) / 2);

describe('range-fit core', () => {
  it('joinRuns merges runs linked by a tie', () => {
    expect(joinRuns([['a', 'b'], ['c'], ['d']], [['b', 'd']])).toEqual([['a', 'b', 'd'], ['c']]);
  });
  it('joinRuns merges three runs transitively', () => {
    expect(joinRuns([['a'], ['b'], ['c']], [['a', 'b'], ['b', 'c']])).toEqual([['a', 'b', 'c']]);
  });
  it('joinRuns ignores a tie to an unknown id', () => {
    expect(joinRuns([['a'], ['b']], [['a', 'zz']])).toEqual([['a'], ['b']]);
  });
  it('planShifts moves a phrase below range up as one', () => {
    const plan = planShifts([[ev('a', mid), ev('b', range.low - 1)]], range, true);
    expect(plan.shifts).toEqual({ a: 12, b: 12 });
    expect(plan.bothWays).toEqual([]);
    expect(plan.stillOut).toEqual([]);
  });
  it('planShifts leaves a both-ways phrase and reports it', () => {
    const plan = planShifts([[ev('a', range.low - 1), ev('b', range.high + 1)]], range, true);
    expect(plan.shifts).toEqual({ a: 0, b: 0 });
    expect(plan.bothWays).toEqual([['a', 'b']]);
  });
  it('planShifts keeps a still-out move and reports it', () => {
    const plan = planShifts([[ev('a', range.low - 13)]], range, true);
    expect(plan.shifts).toEqual({ a: 12 });
    expect(plan.stillOut).toEqual([['a']]);
  });
  it('a chord with one note out moves whole', () => {
    const plan = planShifts([[ev('c', mid, range.high + 2), ev('d', mid)]], range, true);
    expect(plan.shifts).toEqual({ c: -12, d: -12 });
  });
  it('no range or autoRange off plans no shifts', () => {
    const low = [[ev('a', range.low - 1)]];
    expect(planShifts(low, range, false).shifts).toEqual({ a: 0 });
    expect(planShifts(low, undefined, true).shifts).toEqual({ a: 0 });
  });
  it('override extends along its tie chain', () => {
    const chainOf = tieChainOf([['a', 'b'], ['b', 'c']]);
    expect(chainOf('b')).toEqual(['a', 'b', 'c']);
    expect(chainOf('z')).toEqual(['z']);
    expect(applyOverrides({ a: 0, b: 0, c: 0, z: 0 }, { b: 12 }, chainOf)).toEqual({ a: 12, b: 12, c: 12, z: 0 });
  });
  it('first override on a chain wins', () => {
    const chainOf = tieChainOf([['a', 'b'], ['b', 'c']]);
    expect(applyOverrides({}, { c: -12, b: 12 }, chainOf)).toEqual({ a: 12, b: 12, c: 12 });
  });
  it('override beats planned shift', () => {
    const plan = planShifts([[ev('a', range.low - 1)]], range, true);
    expect(applyOverrides(plan.shifts, { a: 0 }, tieChainOf([])).a).toBe(0);
  });
});
