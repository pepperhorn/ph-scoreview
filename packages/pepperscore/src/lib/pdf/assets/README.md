# PDF fonts

Poppins-Regular.ttf and Poppins-SemiBold.ttf are unmodified files from
https://github.com/google/fonts/tree/main/ofl/poppins (downloaded 2026-11-10),
under the SIL OFL 1.1. The package's existing Poppins notice covers them.

PepperScoreMusic.ttf, PepperScoreHand.ttf and PepperScoreHandText.ttf derive from
Bravura.otf, Petaluma.otf and PetalumaScript.otf in the respective upstream repos:
https://github.com/steinbergmedia/bravura/tree/master/redist/otf
https://github.com/steinbergmedia/petaluma/tree/master/redist/otf

Converted with otf2ttf 0.2 (cubic CFF to quadratic TrueType), then renamed using
fontTools.ttLib.TTFont name-table IDs 1, 2, 3, 4, 6, 16 and 17 to avoid reserved
font names. The PDF code keeps the reader's family names only as internal aliases.
Copyright and OFL texts are alongside these files and in third-party notices.
These conversions are needed because jsPDF embeds TrueType, not CFF OTF or WOFF2.
The conversion tool is a development utility, not a runtime dependency.

SHA-256 of the distributed font assets:

```text
f6eebf20526ed8db90c99803352fb1160dbd7ffaec768064626f6c8f2195f2e6  PepperScoreHand.ttf
e92b875d5ad2081cad1ec9301d25ae91f281ce809df9fcef477b617e2d465555  PepperScoreHandText.ttf
324b6038a4b82bf6941966d287f82859babda0df6b8daca8c9a0e6ac6ea7965f  PepperScoreMusic.ttf
7e65201e9b79159e2300267cc885e16c8dcef2424cdfa09a29bfb0980a94a7ba  Poppins-Regular.ttf
d3bf1bdaf0550e83da9ac0b1d1d9fe6db086835a83aa28578e609a394b9a0286  Poppins-SemiBold.ttf
```
