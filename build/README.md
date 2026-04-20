# Build helpers

Lightweight build tooling for the Italia Camera Explorer perf bundle. Nothing
here runs at page load time — these scripts regenerate the pre-built assets
that ship in `vendor/` and `data/derived/geometries_web/`.

## d3-slim

`build/d3-slim.entry.js` lists exactly the d3 APIs the app uses. We bundle it
with esbuild into an IIFE that exposes a `window.d3` global, so the app code
keeps the same `d3.*` usage but ships a fraction of the bytes.

Regenerate with:

```bash
cd build
npm install --no-save d3-array@3 d3-axis@3 d3-color@3 d3-format@3 d3-geo@3 \
  d3-interpolate@3 d3-scale@4 d3-scale-chromatic@3 d3-selection@3 d3-shape@3 \
  d3-transition@3 d3-zoom@3 esbuild@0.24.0
./node_modules/.bin/esbuild d3-slim.entry.js \
  --bundle --minify --format=iife --global-name=d3 \
  --footer:js='if(typeof window!=="undefined"){window.d3=d3;}' \
  --outfile=../vendor/d3/d3-slim.min.js \
  --legal-comments=none
gzip -kf ../vendor/d3/d3-slim.min.js
```

Current delta vs. the full d3 bundle:

| Bundle | Bytes | Gzipped |
|---|---:|---:|
| `vendor/d3/d3.min.js` (full d3 v7) | ~280 KB | ~93 KB |
| `vendor/d3/d3-slim.min.js` (this) | ~94 KB | ~33 KB |

If new d3 APIs are introduced in the app, add them to `d3-slim.entry.js`
before rebuilding, otherwise the page will error with `d3.X is undefined`.

## TopoJSON geometry

`build/build-topojson.mjs` converts the quantized GeoJSON boundary packs under
`data/derived/geometries_web/` to TopoJSON. TopoJSON ships the same visual
resolution in roughly half the gzipped bytes. The loader in
`modules/data.js::parseGeometryObject` already accepts either format.
