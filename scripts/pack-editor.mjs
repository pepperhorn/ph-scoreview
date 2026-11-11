import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd = root) => execFileSync(npm, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const work = mkdtempSync(join(tmpdir(), 'editor-pack-'));
try {
  for (const pkg of ['pepperscore', '@pepperhorn/pepperscore-editor']) run(['run', 'build', '-w', pkg]);
  const pack = pkg => JSON.parse(run(['pack', '--json', '--ignore-scripts', '--pack-destination', work, '-w', pkg]))[0];
  const viewer = pack('pepperscore');
  const editor = pack('@pepperhorn/pepperscore-editor');
  const files = editor.files.map(file => file.path);
  for (const expected of ['dist/index.js', 'dist/index.d.ts', 'dist/style.css', 'README.md', 'package.json']) assert.ok(files.includes(expected), expected);
  assert.ok(files.every(path => path.startsWith('dist/') || ['README.md', 'package.json'].includes(path)), 'only dist, README and manifest ship');
  const app = join(work, 'consumer');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(['install', '--no-audit', '--no-fund', join(work, viewer.filename), join(work, editor.filename), 'react@^19', 'react-dom@^19', '@types/react@^19', '@types/react-dom@^19', 'typescript@^5.9.3', 'vite@^8.3.1'], app);
  writeFileSync(join(app, 'consumer.ts'), `import { PepperScoreEditor, verifyLicence, type EditorPlugin, type PepperScoreEditorProps } from '@pepperhorn/pepperscore-editor';
import 'pepperscore/style.css';
import '@pepperhorn/pepperscore-editor/style.css';
const props: PepperScoreEditorProps = { licenceKey: 'dev' };
const plugins: EditorPlugin[] = [];
console.log(PepperScoreEditor, props, plugins, await verifyLicence('dev'));
`);
  writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, jsx: 'react-jsx', skipLibCheck: false }, include: ['consumer.ts'] }));
  run(['exec', '--', 'tsc', '-p', '.'], app);
  execFileSync(process.execPath, ['--input-type=module', '-e', "import assert from 'node:assert/strict'; import { PepperScoreEditor, verifyLicence } from '@pepperhorn/pepperscore-editor'; assert.ok(PepperScoreEditor); assert.equal(await verifyLicence('dev'), null);"], { cwd: app, stdio: 'inherit' });
  writeFileSync(join(app, 'index.html'), '<script type="module" src="/consumer.ts"></script>');
  run(['exec', '--', 'vite', 'build'], app);
  console.log(`Editor pack: ${files.length} allowed files; fresh consumer ESM import, declarations, CSS and Vite build passed; production dev licence rejected.`);
} finally { rmSync(work, { recursive: true, force: true }); }
