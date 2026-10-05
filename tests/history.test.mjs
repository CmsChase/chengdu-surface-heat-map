import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gridIdentity, decodeBlock, historyRows, historySummary, comparisonRows, comparisonSummary, parseWgs84, encodeView, decodeView, dataStatus, inResearchBoundary } from '../src/history.js';

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
    comparison: { enabled: false, a: -1, b: -1, pick: 'A' },
  });
  const paired = encodeView({ layer: 'crop', date: '2022-06-07', center: { lat: 30.67, lng: 104.06 }, zoom: 11.5, selected: 23, opacity: .5, comparison: { enabled: true, a: 123, b: 456, pick: 'B' } });
  assert.deepEqual(decodeView(paired, new Set(['crop']), new Set(['2022-06-07']), 231515).comparison, { enabled: true, a: 123, b: 456, pick: 'B' });
  assert.equal(decodeView('?compare=1&gridA=123&gridB=123', new Set(), new Set(), 231515).comparison.b, -1);
  assert.equal(dataStatus({ inRange: false, applicable: false, layer: 'crop', value: null }), '研究范围外');
  assert.equal(dataStatus({ inRange: true, applicable: false, layer: 'crop', value: null }), '无适用土地');
  assert.equal(dataStatus({ inRange: true, applicable: true, layer: 'observed', value: null }), '当日没有合格温度记录');
  assert.equal(dataStatus({ inRange: true, applicable: true, layer: 'crop', value: null }), '特征来源缺失');
  assert.equal(dataStatus({ inRange: true, applicable: true, layer: 'crop', value: 0 }), '有效数值为零');
});

test('same-date comparison uses saved absolute values, preserves 82 states and reverses when swapped', () => {
  const dates = [
    { date: '2021-06-01', observed_area_weighted_median_c: 10 },
    { date: '2022-06-01', observed_area_weighted_median_c: 100 },
    { date: '2023-08-01', observed_area_weighted_median_c: -50 },
    { date: '2024-08-01', observed_area_weighted_median_c: 70 },
    { date: '2024-09-01', observed_area_weighted_median_c: 70 },
  ];
  const a = [
    { dateIndex: 0, temperature: 3000, qa: 70 },
    { dateIndex: 1, temperature: 2500, qa: 80 },
    { dateIndex: 3, temperature: 2000, qa: 90 },
  ];
  const b = [
    { dateIndex: 0, temperature: 2800, qa: 60 },
    { dateIndex: 2, temperature: 2200, qa: 50 },
    { dateIndex: 3, temperature: 2000, qa: 95 },
  ];
  const rows = comparisonRows(a, b, dates);
  assert.deepEqual(rows.map(row => row.status), ['both', 'a_only', 'b_only', 'both', 'neither']);
  assert.deepEqual(rows.map(row => row.difference), [2, null, null, 0, null]);
  assert.deepEqual([rows[0].aQa, rows[0].bQa], [70, 60]);
  const summary = comparisonSummary(rows);
  assert.equal(summary.median, 1);
  assert.deepEqual([summary.aCount, summary.bCount, summary.sharedCount, summary.aWarmerCount, summary.equalCount], [3, 3, 2, 1, 1]);
  assert.deepEqual(summary.years, { 2021: 1, 2024: 1 });
  assert.deepEqual(summary.months, { '06': 1, '08': 1 });
  const reversed = comparisonRows(b, a, dates);
  assert.deepEqual(reversed.map(row => row.difference), rows.map(row => row.difference === null ? null : row.difference === 0 ? 0 : -row.difference));
  assert.equal(comparisonSummary(reversed).sharedCount, summary.sharedCount);
  assert.equal(comparisonSummary(comparisonRows(a.slice(1, 2), b.slice(1, 2), dates)).sharedCount, 0);
  assert.equal(comparisonSummary(comparisonRows(a.slice(0, 1), b.slice(0, 1), dates)).sharedCount, 1);
});

test('two real grids in adjacent blocks match independent date-file differences', () => {
  const lattice = file('history/grid-lattice.bin');
  const indices = [143331, 143697];
  const records = indices.map(index => {
    const identity = gridIdentity(lattice.readUInt16LE(index * 4), lattice.readUInt16LE(index * 4 + 2));
    const blockBytes = file(`history/${identity.block}.bin`);
    const block = decodeBlock(blockBytes.buffer.slice(blockBytes.byteOffset, blockBytes.byteOffset + blockBytes.byteLength), mapManifest.dates);
    return block.get(identity.slot);
  });
  const rows = comparisonRows(records[0], records[1], mapManifest.dates);
  assert.equal(rows.length, 82);
  assert.equal(comparisonSummary(rows).sharedCount, 17);
  for (let i = 0; i < 82; i++) {
    const bytes = file(`dates/${mapManifest.dates[i].date}.bin`);
    const a = bytes.readInt16LE(indices[0] * 2);
    const b = bytes.readInt16LE(indices[1] * 2);
    const expected = a === -32768 || b === -32768 ? null : (a - b) / 100;
    assert.equal(rows[i].difference, expected, mapManifest.dates[i].date);
  }
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
