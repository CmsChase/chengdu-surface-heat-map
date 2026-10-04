import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { layerById, decodeValue } from '../src/layers.js';

const root = new URL('../public/data/', import.meta.url);
const metadata = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const file = path => readFileSync(new URL(path, root));

test('public map contains only the accepted development-date scope', () => {
  assert.equal(metadata.grid_count, 231515);
  assert.equal(metadata.positive_land_grid_count, 230978);
  assert.equal(metadata.date_count, 82);
  assert.equal(metadata.observed_grid_date_records, 1964794);
  assert.equal(metadata.dates.length, 82);
  assert.equal(metadata.dates.reduce((total, date) => total + date.rows, 0), 1964794);
  assert(metadata.dates.every(date => /^202[1-4]-\d\d-\d\d$/.test(date.date)));
  assert(metadata.dates.some(date => date.date === metadata.initial_date));
  assert.equal(file('grids.bin').byteLength, metadata.grid_count * 8);
  assert.equal(file('applicable.bin').byteLength, metadata.grid_count);
  assert.equal(file('support.bin').byteLength, metadata.grid_count * 2);
  assert.equal(file('weather-index.bin').byteLength, metadata.grid_count * 2);
});

test('each date preserves exactly its QA-qualified labels and missing cells', () => {
  const n = metadata.grid_count;
  for (const date of metadata.dates) {
    const bytes = file(`dates/${date.date}.bin`);
    assert.equal(bytes.byteLength, n * 3);
    const temperatures = new Int16Array(bytes.buffer, bytes.byteOffset, n);
    const qa = new Uint8Array(bytes.buffer, bytes.byteOffset + n * 2, n);
    let present = 0;
    for (let i = 0; i < n; i++) {
      const available = temperatures[i] !== -32768;
      assert.equal(qa[i] !== 255, available);
      if (available) present++;
    }
    assert.equal(present, date.rows, date.date);
    const weather = JSON.parse(file(`weather/${date.date}.json`));
    assert.equal(weather.length, metadata.weather_point_count);
    assert(weather.every(row => row.length === metadata.weather_fields.length));
  }
});

test('all display files match the export receipt', () => {
  for (const [path, expected] of Object.entries(metadata.file_sha256)) {
    const actual = createHash('sha256').update(file(path)).digest('hex');
    assert.equal(actual, expected, path);
  }
  const builtBytes = file('built.bin');
  const built = new Int16Array(builtBytes.buffer, builtBytes.byteOffset, builtBytes.byteLength / 2);
  assert.equal(built.length, metadata.grid_count);
  const unlisted = readdirSync(new URL('dates/', root)).filter(name => !metadata.dates.some(date => `${date.date}.bin` === name));
  assert.deepEqual(unlisted, []);
});

test('map value decoding keeps no-data and measurement meanings apart', () => {
  assert.equal(decodeValue('relative', -32768, 30), null);
  assert.equal(decodeValue('qa', 255), null);
  assert.equal(decodeValue('relative', 3200, 30), 2);
  assert.equal(decodeValue('tree', 750), 75);
  assert(Math.abs(decodeValue('t2m_last_k', 300) - 26.85) < 1e-10);
  assert(layerById.has('relative'));
});
