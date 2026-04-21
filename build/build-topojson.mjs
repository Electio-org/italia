#!/usr/bin/env node
// Convert full-resolution GeoJSON boundary packs to topology-preserving
// TopoJSON. Uses topojson-simplify so adjacent polygons share simplified
// arcs — this is what prevents the "kaleidoscope" / gappy look when
// zooming into the canvas map. The previous version simplified each
// polygon independently (via scripts/build_web_geometry_pack.py) and
// produced 7-vertex triangles that did not match their neighbors.
//
// Output:
//   data/derived/geometries_web/<layer>_<year>.topojson (+ .gz)
//   data/derived/geometries_web/<layer>_<year>.geojson (GeoJSON fallback)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as topojsonServer from 'topojson-server';
import * as topojsonSimplify from 'topojson-simplify';
import * as topojsonClient from 'topojson-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// minWeight is the post-presimplify triangle-area threshold (integer units
// after quantization). Larger value = more aggressive. The chosen values
// give ~115 verts/comune average (vs 7 before) at ~7 MB gzipped transfer,
// which matches GERDA-grade sharpness at zoom 20-30× without blowing up
// the first-paint cost.
const CONVERSIONS = [
  {
    input: 'data/derived/geometries/municipalities_2021.geojson',
    outputTopo: 'data/derived/geometries_web/municipalities_2021.topojson',
    outputGeo: 'data/derived/geometries_web/municipalities_2021.geojson',
    objectKey: 'municipalities',
    quantization: 1e5,
    minWeight: 5000,
  },
  {
    input: 'data/derived/geometries/provinces_2021.geojson',
    outputTopo: 'data/derived/geometries_web/provinces_2021.topojson',
    outputGeo: 'data/derived/geometries_web/provinces_2021.geojson',
    objectKey: 'provinces',
    quantization: 1e5,
    minWeight: 5000,
  },
];

function fileSize(p) {
  try { return fs.statSync(p).size; }
  catch { return null; }
}

function vertexCount(geojson) {
  let n = 0;
  const walk = coords => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') { n += 1; return; }
    for (const c of coords) walk(c);
  };
  for (const f of geojson.features || []) walk(f.geometry && f.geometry.coordinates);
  return n;
}

for (const { input, outputTopo, outputGeo, objectKey, quantization, minWeight } of CONVERSIONS) {
  const inputPath = path.join(repoRoot, input);
  const outputTopoPath = path.join(repoRoot, outputTopo);
  const outputGeoPath = path.join(repoRoot, outputGeo);
  if (!fs.existsSync(inputPath)) {
    console.warn(`skip: ${input} not present`);
    continue;
  }
  const t0 = Date.now();
  const geojson = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const beforeVertices = vertexCount(geojson);

  // Build a topology and let topojson-simplify remove vertices whose
  // effective triangle area is below `minWeight`. Because topology is
  // shared, adjacent polygons get the same simplified arcs.
  let topology = topojsonServer.topology({ [objectKey]: geojson }, quantization);
  topology = topojsonSimplify.presimplify(topology);
  topology = topojsonSimplify.simplify(topology, minWeight);

  const serialised = JSON.stringify(topology);
  fs.mkdirSync(path.dirname(outputTopoPath), { recursive: true });
  fs.writeFileSync(outputTopoPath, serialised);
  fs.writeFileSync(outputTopoPath + '.gz', zlib.gzipSync(serialised, { level: 9 }));

  // Also emit a GeoJSON fallback so index.html consumers that cannot load
  // topojson (service worker warm paths, offline tests) still work.
  const geoback = topojsonClient.feature(topology, topology.objects[objectKey]);
  const geobackText = JSON.stringify(geoback);
  fs.writeFileSync(outputGeoPath, geobackText);
  fs.writeFileSync(outputGeoPath + '.gz', zlib.gzipSync(geobackText, { level: 9 }));
  const afterVertices = vertexCount(geoback);

  const ms = Date.now() - t0;
  console.log(
    `${input} (${beforeVertices} verts)  →  ${outputTopo}`
    + ` (${(serialised.length / 1024 / 1024).toFixed(2)} MB,`
    + ` gz ${(fileSize(outputTopoPath + '.gz') / 1024 / 1024).toFixed(2)} MB,`
    + ` ${afterVertices} verts, ${ms} ms)`
  );
}
