#!/usr/bin/env node
// Convert the web-optimized GeoJSON boundary packs to quantized TopoJSON.
// The loader in modules/data.js accepts both formats; TopoJSON typically halves
// the gzipped transfer size for the same visual resolution.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as topojson from 'topojson-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CONVERSIONS = [
  {
    input: 'data/derived/geometries_web/municipalities_2021.geojson',
    output: 'data/derived/geometries_web/municipalities_2021.topojson',
    objectKey: 'municipalities',
    quantization: 1e5
  },
  {
    input: 'data/derived/geometries_web/provinces_2021.geojson',
    output: 'data/derived/geometries_web/provinces_2021.topojson',
    objectKey: 'provinces',
    quantization: 1e5
  }
];

function fileSize(p) {
  try { return fs.statSync(p).size; }
  catch { return null; }
}

function gzipSize(text) {
  return zlib.gzipSync(text, { level: 9 }).length;
}

for (const { input, output, objectKey, quantization } of CONVERSIONS) {
  const inputPath = path.join(repoRoot, input);
  const outputPath = path.join(repoRoot, output);
  if (!fs.existsSync(inputPath)) {
    console.warn(`skip: ${input} not present`);
    continue;
  }
  const geojson = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const topology = topojson.topology({ [objectKey]: geojson }, quantization);
  const serialised = JSON.stringify(topology);
  fs.writeFileSync(outputPath, serialised);
  fs.writeFileSync(outputPath + '.gz', zlib.gzipSync(serialised, { level: 9 }));

  const inputGz = fileSize(inputPath + '.gz');
  const outputGz = fileSize(outputPath + '.gz');
  console.log(
    `${input}: ${(fileSize(inputPath) / 1024).toFixed(0)} KB (gz ${(inputGz / 1024).toFixed(0)} KB)` +
    `  →  ${output}: ${(serialised.length / 1024).toFixed(0)} KB (gz ${(outputGz / 1024).toFixed(0)} KB)`
  );
}
