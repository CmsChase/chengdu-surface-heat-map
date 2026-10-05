import test from 'node:test';
import assert from 'node:assert/strict';
import { singleHistoryCsv, twoGridCsv } from '../src/evidence.js';
import { historyRows, comparisonRows } from '../src/history.js';

const dates = [
  { date: '2021-06-01', observed_area_weighted_median_c: 25.1234 },
  { date: '2022-07-01', observed_area_weighted_median_c: 30 },
  { date: '2023-08-01', observed_area_weighted_median_c: 35 },
  { date: '2024-09-01', observed_area_weighted_median_c: 40 },
];
const a = [{ dateIndex: 0, temperature: 3000, qa: 80 }, { dateIndex: 1, temperature: 2500, qa: 75 }];
const b = [{ dateIndex: 0, temperature: 2800, qa: 90 }, { dateIndex: 2, temperature: 3300, qa: 60 }];
const lines = value => value.replace(/^\uFEFF/, '').trimEnd().split('\r\n').map(line => line.slice(1, -1).split('","'));

test('single CSV retains all dates, explicit missing status, UTF-8 BOM and UI rounding', () => {
  const csv = singleHistoryCsv({ gridId: 'g250_e1_n2', lat: 30.123456, lon: 104.987654, rows: historyRows(a, dates) });
  assert(csv.startsWith('\uFEFF'));
  const [header, ...rows] = lines(csv);
  assert.equal(rows.length, dates.length);
  assert.deepEqual(rows[0].slice(0, 5), ['g250_e1_n2', '30.12346', '104.98765', '2021-06-01', '有效观测']);
  assert.deepEqual(rows[0].slice(5), ['30.00', '4.88', '80']);
  assert.deepEqual(rows[2].slice(4), ['无合格观测', '', '', '']);
  assert.match(header.join(','), /绝对地表温度_摄氏度/);
});

test('two-grid CSV preserves four statuses, blank missing values and direct A minus B', () => {
  const source = comparisonRows(a, b, dates);
  const [header, ...rows] = lines(twoGridCsv({ aId: 'A', bId: 'B', rows: source }));
  assert.equal(rows.length, dates.length);
  assert.deepEqual(rows.map(row => row[3]), ['共同有效', '仅A有效', '仅B有效', '两者均无观测']);
  assert.deepEqual(rows[0].slice(4), ['30.00', '28.00', '2.00', '80', '90']);
  assert.deepEqual(rows[1].slice(4), ['25.00', '', '', '75', '']);
  assert.deepEqual(rows[3].slice(4), ['', '', '', '', '']);
  assert.match(header.join(','), /A减B_摄氏度/);
  const reversed = lines(twoGridCsv({ aId: 'B', bId: 'A', rows: comparisonRows(b, a, dates) }));
  assert.equal(reversed[1][6], '-2.00');
  assert.deepEqual(reversed.slice(1).map(row => row[3]), ['共同有效', '仅B有效', '仅A有效', '两者均无观测']);
});

test('zero and one shared date remain explicit', () => {
  const none = lines(twoGridCsv({ aId: 'A', bId: 'B', rows: comparisonRows(a.slice(1), b.slice(1), dates) }));
  assert(none.slice(1).every(row => row[6] === ''));
  const one = lines(twoGridCsv({ aId: 'A', bId: 'B', rows: comparisonRows(a.slice(0, 1), b.slice(0, 1), dates) }));
  assert.deepEqual(one.slice(1).map(row => row[6]), ['2.00', '', '', '']);
});
