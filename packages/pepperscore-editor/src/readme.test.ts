import readme from '../README.md?raw';
import { describeKey, KEYMAP } from './ui/keymap';

test('the README keymap table lists every binding with its keys', () => {
  const rows = readme.split('\n').filter((line) => line.startsWith('| ')).map((line) => line.trim());
  const missing = KEYMAP.map((b) => `| ${describeKey(b).replace(/\|/g, '\\|')} | ${b.label} |`).filter((row) => !rows.some((r) => r.startsWith(row)));
  expect(missing).toEqual([]);
});
