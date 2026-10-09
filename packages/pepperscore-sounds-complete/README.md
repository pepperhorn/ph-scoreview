# pepperscore-sounds-complete

Assets for [pepperscore](https://www.npmjs.com/package/pepperscore) (~54 MB): music fonts, instrument icons, Perfect Drums,
TimGM6mb.sf2 and all 128 FluidR3 GM sounds listed in `pack.json`. No JavaScript.

pepperscore loads `pepperscore-sounds-core` from jsDelivr by default; pass `soundPack="complete"` to load this package
instead. To self-host, copy this package's directory into your site's public folder and pass its URL as `assetBaseUrl`,
e.g. `cp -r node_modules/pepperscore-sounds-complete public/pepperscore-sounds`
and `<PepperScore assetBaseUrl="/pepperscore-sounds/" … />`.

In this repository this package holds the only copy of the assets; `pepperscore-sounds-core` is generated from it.
Licenses: see `LICENSES.md`.
