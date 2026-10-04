import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gridIdentity, decodeBlock, historyRows, historySummary, parseWgs84, encodeView, decodeView, dataStatus, inResearchBoundary } from '../src/history.js';

const root = new URL('../public/data/', import.meta.url);
const file = path => readFileSync(new URL(path, root));
const mapManifest = JSON.parse(file('manifest.json'));
const historyManifest = JSON.parse(file('history/manifest.json'));

test('coordinates, link state and explicit data statuses', () => {
  assert.deepEqual(parseWgs84('30.67, 104.06'), { lat: 30.67, lon: 104.06 });
  assert.throws(() => parseWgs84('100,30'), /范围/);
  assert.throws(() => parseWgs84('30'), /两个数字/);
  const query = encodeView({ layer: 'crop', date: '2022-06-07', center: { lat: 30.67, lng: 104.06 }, zoom: 11.5, selected: 23, opacity: .5 });
  assert.deepEqual(decodeView(query, new Set(['crop']), new Set(['2022-06-07']), 231515), {
    layer: 'crop', date: '2022-06-07', center: { lat: 30.67, lon: 104.06 },
    zoom: 11.5, selected: 23, opacity: .5,
  });
  assert.equal(dataStatus({ inRange: false, applicable: false, layer: 'crop', value: null }), '研究范围外');
  assert.equal(dataStatus({ inRange: true, applicable: false, layer: 'crop', value: null }), '无适用土地');
  assert.equal(dataStatus({ inRange: true, applicable: true, layer: 'observed', value: null }), '当日没有合格温度记录');
  assert.equal(dataStatus({ inRange: true, applicable: true, layer: 'crop', value: null }), '特征来源缺失');
  assert.equal(dataStatus({ inRange: true, applicable: true, layer: 'crop', value: 0 }), '有效数值为零');
});

test('technical boundary preserves original WGS84 geometry and holes', () => {
  const boundary = JSON.parse(file('history/technical-boundary.geojson'));
  assert.equal(boundary.crs.properties.name, 'EPSG:4326');
  const geometry = boundary.features[0].geometry;
  assert(inResearchBoundary({ lon: 104.06, lat: 30.67 }, geometry));
  assert(inResearchBoundary({ lng: 104.05975, lat: 30.671286 }, geometry));
  assert(!inResearchBoundary({ lon: 110, lat: 35 }, geometry));
});

test('every sparse block entry equals the accepted date file at the same grid key', () => {
  assert.equal(historyManifest.date_count, 82);
  assert.equal(historyManifest.grid_count, 231515);
  assert.equal(historyManifest.observed_records, 1964794);
  assert.deepEqual(historyManifest.date_order, mapManifest.dates.map(date => date.date));
  const latticeBytes = file('history/grid-lattice.bin');
  assert.equal(createHash('sha256').update(latticeBytes).digest('hex'), historyManifest.grid_lattice.sha256);
  const lattice = new Uint16Array(latticeBytes.buffer, latticeBytes.byteOffset, historyManifest.grid_count * 2);
  const byBlockSlot = new Map();
  for (let index = 0; index < historyManifest.grid_count; index++) {
    const identity = gridIdentity(lattice[index * 2], lattice[index * 2 + 1]);
    const key = `${identity.block}:${identity.slot}`;
    assert(!byBlockSlot.has(key), key);
    byBlockSlot.set(key, index);
  }
  let total = 0;
  const sparseByDate = Array.from({ length: 82 }, () => []);
  for (const [block, receipt] of Object.entries(historyManifest.blocks)) {
    const bytes = file(`history/${block}.bin`);
    assert.equal(bytes.byteLength, receipt.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256);
    const decoded = decodeBlock(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mapManifest.dates);
    for (const [slot, entries] of decoded) {
      const index = byBlockSlot.get(`${block}:${slot}`);
      assert.notEqual(index, undefined);
      for (const entry of entries) {
        sparseByDate[entry.dateIndex].push({ index, ...entry });
        total++;
      }
    }
  }
  assert.equal(total, 1964794);
  for (let dateIndex = 0; dateIndex < 82; dateIndex++) {
    const date = mapManifest.dates[dateIndex];
    const raw = file(`dates/${date.date}.bin`);
    const temperature = new Int16Array(raw.buffer, raw.byteOffset, historyManifest.grid_count);
    const qa = new Uint8Array(raw.buffer, raw.byteOffset + historyManifest.grid_count * 2, historyManifest.grid_count);
    assert.equal(sparseByDate[dateIndex].length, date.rows);
    for (const entry of sparseByDate[dateIndex]) {
      assert.equal(entry.temperature, temperature[entry.index]);
      assert.equal(entry.qa, qa[entry.index]);
    }
  }
  const one = sparseByDate.find(entries => entries.length);
  const sample = historyRows([{ dateIndex: one[0].dateIndex, temperature: one[0].temperature, qa: one[0].qa }], mapManifest.dates);
  assert.equal(historySummary(sample).count, 1);
  assert.equal(sample.filter(row => row.observed === null).length, 81);
  assert.equal(sample[one[0].dateIndex].relative, one[0].temperature / 100 - mapManifest.dates[one[0].dateIndex].observed_area_weighted_median_c);
});
