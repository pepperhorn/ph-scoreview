// Asset base resolution (packages/pepperscore/src/lib/assets.ts), run in Node: the module has no runtime imports.
import assert from 'node:assert/strict';
import { assetUrl, defaultAssetBaseUrl, resolveAssetBase, SOUNDS_VERSION } from '../packages/pepperscore/src/lib/assets.ts';

const page = 'https://example.com/songs/view.html';
assert.equal(defaultAssetBaseUrl('core'), `https://cdn.jsdelivr.net/npm/pepperscore-sounds-core@${SOUNDS_VERSION}/`);
assert.equal(defaultAssetBaseUrl('complete'), `https://cdn.jsdelivr.net/npm/pepperscore-sounds-complete@${SOUNDS_VERSION}/`);
assert.equal(resolveAssetBase(undefined, 'core', page), defaultAssetBaseUrl('core'));
assert.equal(resolveAssetBase(undefined, 'complete', page), defaultAssetBaseUrl('complete'));
assert.equal(resolveAssetBase('   ', 'core', page), defaultAssetBaseUrl('core'));
assert.equal(resolveAssetBase('/', 'core', page), 'https://example.com/');
// Review Focus 4: no trailing slash, and relative paths, still resolve under the base.
assert.equal(resolveAssetBase('/custom-assets', 'core', page), 'https://example.com/custom-assets/');
assert.equal(resolveAssetBase('assets', 'core', page), 'https://example.com/songs/assets/');
assert.equal(resolveAssetBase('https://cdn.example.org/s/', 'core', page), 'https://cdn.example.org/s/');
assert.equal(assetUrl('https://example.com/a/', '/soundfonts/fluidr3/flute.json'), 'https://example.com/a/soundfonts/fluidr3/flute.json');
assert.equal(assetUrl('https://example.com/a/', 'pack.json'), 'https://example.com/a/pack.json');
console.log('Asset base: defaults, relative and absolute bases, missing trailing slash and asset paths passed');
