# pepperscore-sounds-core

Assets for [pepperscore](https://www.npmjs.com/package/pepperscore) (~15 MB): music fonts, instrument icons, Perfect Drums,
TimGM6mb.sf2 and the 19 common FluidR3 GM sounds listed in `pack.json`; every other GM program plays through TimGM6mb.
No JavaScript.

pepperscore loads these from jsDelivr by default. To self-host, copy this package's directory into your site's public
folder and pass its URL as `assetBaseUrl`, e.g. `cp -r node_modules/pepperscore-sounds-core public/pepperscore-sounds`
and `<PepperScore assetBaseUrl="/pepperscore-sounds/" … />`.

In this repository the files are generated from `pepperscore-sounds-complete` by `npm run sounds:core` (and by `prepack`).
Licenses: see `LICENSES.md`.
