import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { layers, layerById, weatherFieldIds, decodeValue, displayValue } from './layers.js';
import { canvasFrame } from './map-geometry.js';
import { gridIdentity, decodeBlock, historyRows, historySummary, comparisonRows, comparisonSummary, parseWgs84, encodeView, decodeView, dataStatus, inResearchBoundary } from './history.js';
import { singleHistoryCsv, twoGridCsv } from './evidence.js';

const base = `${import.meta.env.BASE_URL}data/`;
const $ = (id) => document.getElementById(id);
const state = {
  meta: null,
  coords: null,
  mercatorX: null,
  mercatorY: null,
  applicable: null,
  support: null,
  weatherIndex: null,
  static: new Map(),
  dates: new Map(),
  weather: new Map(),
  layer: 'relative',
  date: null,
  selected: -1,
  generation: 0,
  historyMeta: null,
  lattice: null,
  historyBlocks: new Map(),
  historyExpanded: false,
  staticExpanded: false,
  selectionGeneration: 0,
  opacity: .86,
  boundary: null,
  comparison: { enabled: false, a: -1, b: -1, pick: 'A' },
  comparisonData: null,
  comparisonError: null,
  comparisonGeneration: 0,
};

const map = L.map('map', {
  zoomControl: false,
  preferCanvas: true,
  minZoom: 7,
  maxZoom: 15,
  zoomSnap: 0.25,
}).setView([30.67, 104.06], 10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

async function getBuffer(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`数据文件加载失败: ${path} (${response.status})`);
  return response.arrayBuffer();
}

async function getJSON(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`数据文件加载失败: ${path} (${response.status})`);
  return response.json();
}

function hexToRgb(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function palette(layer) {
  const stops = layer.colors.map(hexToRgb);
  return Array.from({ length: 256 }, (_, index) => {
    const position = index / 255 * (stops.length - 1);
    const left = Math.min(stops.length - 2, Math.floor(position));
    const amount = position - left;
    const rgb = stops[left].map((channel, i) => Math.round(channel + (stops[left + 1][i] - channel) * amount));
    return `rgb(${rgb.join(',')})`;
  });
}

const palettes = new Map(layers.map(layer => [layer.id, palette(layer)]));

function valueAt(index) {
  if (!state.applicable?.[index]) return null;
  const id = state.layer;
  const current = state.dates.get(state.date);
  const dateMeta = state.meta?.dates.find(item => item.date === state.date);
  if (id === 'observed' || id === 'relative') {
    return current ? decodeValue(id, current.temperature[index], dateMeta.observed_area_weighted_median_c) : null;
  }
  if (id === 'qa') return current ? decodeValue(id, current.qa[index]) : null;
  if (id === 'date-count' || id === 'year-count') {
    return state.support?.[index * 2 + (id === 'year-count' ? 1 : 0)] ?? null;
  }
  if (weatherFieldIds.includes(id)) {
    const point = state.weatherIndex?.[index];
    const values = state.weather.get(state.date)?.[point];
    return values ? decodeValue(id, values[weatherFieldIds.indexOf(id)]) : null;
  }
  const values = state.static.get(id);
  return values ? decodeValue(id, values[index]) : null;
}

function colorAt(value) {
  const layer = layerById.get(state.layer);
  const position = Math.max(0, Math.min(255, Math.round((value - layer.min) / (layer.max - layer.min) * 255)));
  return palettes.get(layer.id)[position];
}

function renderLayerList() {
  const groups = [...new Set(layers.map(layer => layer.group))];
  $('layer-list').innerHTML = groups.map(group => `
    <div class="layer-group"><div class="group-label">${group}</div>
      ${layers.filter(layer => layer.group === group).map(layer => `
        <button type="button" class="layer-option ${layer.id === state.layer ? 'selected' : ''}" data-layer="${layer.id}">
          <span class="layer-swatch" style="background:${layer.colors[Math.floor(layer.colors.length / 2)]}"></span><span>${layer.label}</span><span class="layer-chevron">↗</span>
        </button>`).join('')}
    </div>`).join('');
  $('layer-list').querySelectorAll('[data-layer]').forEach(button => {
    button.addEventListener('click', () => selectLayer(button.dataset.layer));
  });
}

function renderYearDateControls() {
  const years = [...new Set(state.meta.dates.map(item => item.date.slice(0, 4)))];
  const chosenYear = state.date.slice(0, 4);
  $('year-select').innerHTML = years.map(year => `<option value="${year}" ${year === chosenYear ? 'selected' : ''}>${year}</option>`).join('');
  const dates = state.meta.dates.filter(item => item.date.startsWith(chosenYear));
  $('date-select').innerHTML = dates.map(item => `<option value="${item.date}" ${item.date === state.date ? 'selected' : ''}>${item.date.slice(5)} · ${item.rows.toLocaleString('zh-CN')} 格</option>`).join('');
  $('date-count').textContent = `${dates.length} 次过境`;
}

function updateLabels() {
  const layer = layerById.get(state.layer);
  const date = state.meta?.dates.find(item => item.date === state.date);
  $('map-layer-title').textContent = layer.label;
  $('map-subtitle').textContent = layer.detail;
  $('layer-kind').textContent = layer.group;
  $('legend-gradient').style.background = `linear-gradient(to right, ${layer.colors.join(',')})`;
  $('legend-min').textContent = layer.min;
  $('legend-max').textContent = layer.max;
  $('legend-unit').textContent = layer.unit;
  $('date-info').innerHTML = !date ? '' : ['relative', 'observed', 'qa'].includes(state.layer)
    ? `<strong>${date.rows.toLocaleString('zh-CN')}</strong><span>格当日有合格观测 · 正土地格的 ${(date.rows / state.meta.positive_land_grid_count * 100).toFixed(1)}%<br>可观测子集参考中位数 ${date.observed_area_weighted_median_c.toFixed(2)} °C</span>`
    : weatherFieldIds.includes(state.layer)
      ? `<strong>${state.date}</strong><span>所选过境日期的历史天气背景；约 9 km 天气格点映射到 250 m 格网。</span>`
      : '<span>静态特征不随日期变化；日期仅用于单格历史观测。</span>';
  $('map-footnote').textContent = ['relative','observed','qa'].includes(state.layer)
    ? `${state.date} · 仅显示该次过境的 QA 合格格网；空白为缺测。色标端点外的实际值以端点色显示，点选可读原值。`
    : weatherFieldIds.includes(state.layer)
      ? `${state.date} · ERA5-Land 约 9 km 天气背景，不是 250 m 实测；来源缺失保持空白。色标端点外饱和显示。`
      : '静态公开特征 · 全部固定正土地格网；色标端点外饱和显示，点选可读原值。';
  $('layer-notice').textContent = ['relative','observed','qa'].includes(state.layer)
    ? '灰白空格表示当日没有合格温度记录，不是温度较低；具体缺测原因未逐格提供。'
    : weatherFieldIds.includes(state.layer)
      ? '天气是约 9 km 背景；来源缺失与有效零值分开显示。'
      : '静态图层不依赖所选日期；空白不代表当日温度缺测。';
  $('date-select').disabled = false;
  $('year-select').disabled = false;
}

async function ensureDate(date) {
  if (state.dates.has(date)) return;
  const buffer = await getBuffer(`dates/${date}.bin`);
  const count = state.meta.grid_count;
  if (buffer.byteLength !== count * 3) throw new Error(`温度文件长度不符: ${date}`);
  state.dates.set(date, {
    temperature: new Int16Array(buffer, 0, count),
    qa: new Uint8Array(buffer, count * 2, count),
  });
  if (state.dates.size > 5) state.dates.delete(state.dates.keys().next().value);
}

async function ensureWeather(date) {
  if (state.weather.has(date)) return;
  const values = await getJSON(`weather/${date}.json`);
  if (values.length !== state.meta.weather_point_count) throw new Error(`天气点数不符: ${date}`);
  state.weather.set(date, values);
  if (state.weather.size > 5) state.weather.delete(state.weather.keys().next().value);
}

async function ensureLayer(id, date) {
  if (['relative', 'observed', 'qa'].includes(id)) await ensureDate(date);
  else if (weatherFieldIds.includes(id)) await ensureWeather(date);
  else if (!['date-count', 'year-count'].includes(id) && !state.static.has(id)) {
    const buffer = await getBuffer(`${id}.bin`);
    if (buffer.byteLength !== state.meta.grid_count * 2) throw new Error(`静态图层长度不符: ${id}`);
    state.static.set(id, new Int16Array(buffer));
  }
}

async function selectLayer(id) {
  if (!layerById.has(id)) return;
  const generation = ++state.generation;
  state.layer = id;
  renderLayerList();
  updateLabels();
  $('map-loading').classList.remove('hidden');
  try {
    await ensureLayer(id, state.date);
    if (generation !== state.generation) return;
    $('map-loading').classList.add('hidden');
    heatLayer.redraw();
    renderInspector();
    saveView();
  } catch (error) { showError(error); }
}

async function selectDate(date) {
  if (!state.meta.dates.some(item => item.date === date)) return;
  const generation = ++state.generation;
  state.date = date;
  renderYearDateControls();
  updateLabels();
  $('map-loading').classList.remove('hidden');
  try {
    await Promise.all([ensureLayer(state.layer, date), ensureDate(date)]);
    if (generation !== state.generation) return;
    $('map-loading').classList.add('hidden');
    heatLayer.redraw();
    renderInspector();
    saveView();
  } catch (error) { showError(error); }
}

function showError(error) {
  $('map-loading').classList.remove('hidden');
  $('map-loading').textContent = error.message ?? '地图数据加载失败，请刷新重试。';
  console.error(error);
}

const CanvasGrid = L.Layer.extend({
  onAdd(mapInstance) {
    this.map = mapInstance;
    this.canvas = L.DomUtil.create('canvas', 'data-canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.pointerEvents = 'none';
    mapInstance.getPanes().overlayPane.appendChild(this.canvas);
    mapInstance.on('moveend zoomend resize', this.redraw, this);
    this.redraw();
  },
  onRemove(mapInstance) {
    mapInstance.off('moveend zoomend resize', this.redraw, this);
    this.canvas.remove();
  },
  redraw() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  },
  draw() {
    if (!state.coords || !this.map) return;
    const size = this.map.getSize();
    const { position, origin } = canvasFrame(this.map);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(size.x * dpr);
    this.canvas.height = Math.round(size.y * dpr);
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, position);
    const context = this.canvas.getContext('2d', { alpha: true });
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const world = 256 * 2 ** this.map.getZoom();
    const thermal = ['relative','observed','qa'].includes(state.layer);
    const cell = Math.max(1.4, Math.min(65, 250 / (156543.0339 * Math.cos(30.7 * Math.PI / 180) / 2 ** this.map.getZoom())));
    const half = cell / 2;
    const count = state.meta.grid_count;
    context.globalAlpha = state.opacity * .78;
    if (thermal) {
      context.fillStyle = 'rgba(234,230,219,.72)';
      for (let index = 0; index < count; index++) {
        if (!state.applicable[index]) continue;
        const x = state.mercatorX[index] * world - origin.x;
        const y = state.mercatorY[index] * world - origin.y;
        if (x < -cell || x > size.x + cell || y < -cell || y > size.y + cell) continue;
        context.fillRect(x - half, y - half, cell + .3, cell + .3);
      }
    }
    context.globalAlpha = state.opacity;
    let lastColor = '';
    for (let index = 0; index < count; index++) {
      const value = valueAt(index);
      if (value === null || !Number.isFinite(value)) continue;
      const x = state.mercatorX[index] * world - origin.x;
      const y = state.mercatorY[index] * world - origin.y;
      if (x < -cell || x > size.x + cell || y < -cell || y > size.y + cell) continue;
      const color = colorAt(value);
      if (color !== lastColor) { context.fillStyle = color; lastColor = color; }
      context.fillRect(x - half, y - half, cell + .3, cell + .3);
    }
    context.globalAlpha = 1;
    const highlight = (index, color, label) => {
      if (index < 0) return;
      const x = state.mercatorX[index] * world - origin.x;
      const y = state.mercatorY[index] * world - origin.y;
      context.strokeStyle = '#142b2e';
      context.lineWidth = 5;
      context.strokeRect(x - Math.max(half, 5), y - Math.max(half, 5), Math.max(cell, 10), Math.max(cell, 10));
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.strokeRect(x - Math.max(half, 5), y - Math.max(half, 5), Math.max(cell, 10), Math.max(cell, 10));
      if (label) {
        context.font = 'bold 14px sans-serif';
        context.fillStyle = '#172c30';
        context.fillRect(x - 9, y - Math.max(half, 5) - 23, 19, 19);
        context.fillStyle = color;
        context.fillText(label, x - 5, y - Math.max(half, 5) - 8);
      }
    };
    if (state.comparison.enabled) {
      highlight(state.comparison.a, '#f6b46d', 'A');
      highlight(state.comparison.b, '#8fd1ce', 'B');
    } else highlight(state.selected, '#f6b46d', '');
  },
});
const heatLayer = new CanvasGrid().addTo(map);

function nearestGrid(latlng) {
  const lat = latlng.lat;
  const lon = latlng.lng;
  const lonScale = Math.cos(lat * Math.PI / 180);
  let nearest = -1;
  let best = Infinity;
  for (let index = 0; index < state.meta.grid_count; index++) {
    const dlat = state.coords[index * 2 + 1] - lat;
    if (Math.abs(dlat) > .003) continue;
    const dlon = (state.coords[index * 2] - lon) * lonScale;
    const squared = dlat * dlat + dlon * dlon;
    if (squared < best) { best = squared; nearest = index; }
  }
  return Math.sqrt(best) * 111.2 <= .23 ? nearest : -1;
}

function saveView() {
  if (!state.meta) return;
  const query = encodeView({ layer: state.layer, date: state.date, center: map.getCenter(), zoom: map.getZoom(), selected: state.selected, opacity: state.opacity, comparison: state.comparison });
  history.replaceState(null, '', `${location.pathname}?${query}`);
}

function identityAt(index) {
  return gridIdentity(state.lattice[index * 2], state.lattice[index * 2 + 1]);
}

function staticValue(id, index) {
  const encoded = state.static.get(id)?.[index];
  return encoded === undefined ? null : decodeValue(id, encoded);
}

function downloadCsv(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printEvidence(html) {
  const preview = $('print-evidence');
  preview.innerHTML = `<div class="evidence-preview-actions"><button id="evidence-do-print" type="button">打印 / 保存 PDF</button><button id="evidence-close" type="button">关闭预览</button></div>${html}`;
  preview.classList.add('open');
  $('evidence-do-print').addEventListener('click', () => window.print());
  $('evidence-close').addEventListener('click', () => { preview.classList.remove('open'); preview.innerHTML = ''; });
}

function evidenceFooter() {
  saveView();
  const link = location.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<div class="evidence-provenance"><div>数据版本：2021–2024 · 82 次物理过境 · 250 m 固定格网</div><div>来源：USGS/NASA Landsat Collection 2 地表温度、ESA WorldCover 2020、NASA SRTM。<br>来源清单：public/data/manifest.json · ${state.historyMeta.source_sha256.accepted_map_manifest}<br>历史清单：public/data/history/manifest.json · 固定格网 ${state.historyMeta.grid_lattice.sha256}</div><div>导出时间（UTC）：${new Date().toISOString()}</div><div>恢复地图选择：<a href="${link}">${link}</a></div></div>`;
}

function distribution(values) {
  return Object.entries(values).sort().map(([key, count]) => `${key}: ${count}`).join(' · ') || '无';
}

async function ensureHistoryBlock(block) {
  if (!state.historyMeta.blocks[block]) throw new Error(`历史块不在固定清单中: ${block}`);
  if (!state.historyBlocks.has(block)) {
    const request = getBuffer(`history/${block}.bin`).then(buffer => {
      if (buffer.byteLength !== state.historyMeta.blocks[block].bytes) throw new Error('历史块长度不符');
      return decodeBlock(buffer, state.meta.dates);
    }).catch(error => { state.historyBlocks.delete(block); throw error; });
    state.historyBlocks.set(block, request);
  }
  return state.historyBlocks.get(block);
}

function historyChart(rows) {
  const valid = rows.filter(row => row.observed !== null);
  const allTime = rows.map(row => Date.parse(`${row.date}T00:00:00Z`));
  const begin = Math.min(...allTime);
  const span = Math.max(...allTime) - begin || 1;
  const x = date => 25 + (Date.parse(`${date}T00:00:00Z`) - begin) / span * 550;
  const low = valid.length ? Math.floor(Math.min(...valid.map(row => row.observed)) / 5) * 5 : 0;
  const high = valid.length ? Math.ceil(Math.max(...valid.map(row => row.observed)) / 5) * 5 + 5 : 50;
  const y = value => 105 - (value - low) / (high - low) * 80;
  const marks = rows.map(row => row.observed === null
    ? `<path d="M${x(row.date).toFixed(1)} 110v6" stroke="#8b9c98" stroke-width="1"/>`
    : `<circle cx="${x(row.date).toFixed(1)}" cy="${y(row.observed).toFixed(1)}" r="2.6" fill="#e2a36e"><title>${row.date} ${row.observed.toFixed(2)} °C</title></circle>`).join('');
  return `<svg viewBox="0 0 600 143" role="img" aria-label="不规则日期的实际地表温度散点；底部短线是缺测日期，无连线或插值"><path d="M25 25v80h550" fill="none" stroke="#8fa5a0"/><text x="0" y="28">${high}°</text><text x="0" y="108">${low}°</text>${marks}<text x="25" y="137">2021</text><text x="540" y="137">2024</text></svg>`;
}

function historyMarkup(index) {
  const identity = identityAt(index);
  const cached = state.historyBlocks.get(identity.block);
  if (!cached || !state.historyData || state.historyData.index !== index) return '<p class="history-wait">正在读取该空间块的历史观测…</p>';
  const rows = state.historyData.rows;
  const summary = historySummary(rows);
  const table = rows.map(row => `<tr class="${row.observed === null ? 'missing' : ''}"><td>${row.date}</td><td>${row.observed === null ? '缺测' : displayValue('observed', row.observed)}</td><td>${row.relative === null ? '—' : displayValue('relative', row.relative)}</td><td>${row.qa === null ? '—' : `${row.qa}%`}</td></tr>`).join('');
  return `<div class="history-summary"><strong>${summary.count} / 82</strong> 个日期有合格观测<br>年份：${distribution(summary.years)}<br>月份：${distribution(summary.months)}</div><div class="history-chart">${historyChart(rows)}<small>按真实日期间隔排列；点为实际观测，底部短线为缺测。没有连线、插值或趋势。</small></div><div class="evidence-actions"><button id="single-csv" type="button">下载82日期 CSV</button><button id="single-print" type="button">打印证据卡 / 保存 PDF</button></div><div class="history-table-wrap"><table><thead><tr><th>日期</th><th>地表温度</th><th>同日温差</th><th>有效土地像元</th></tr></thead><tbody>${table}</tbody></table></div><small>温差参照：当日 QA 可观测格网的固定非水土地面积加权中位数。温度显示至 0.01 °C、比例至 1 个百分点；参照中位数保存至 0.0001 °C。</small>`;
}

function singleEvidenceCard(index) {
  const rows = state.historyData.rows;
  const summary = historySummary(rows);
  const identity = identityAt(index);
  const lat = state.coords[index * 2 + 1];
  const lon = state.coords[index * 2];
  return `<article class="evidence-card"><div class="evidence-heading">成都地表热地图 / 观测证据卡</div><h1>单格历史观测</h1><p>${identity.id} · 250 m 固定格网<br>WGS84 ${lat.toFixed(5)}°N, ${lon.toFixed(5)}°E</p><p>高程 ${displayValue('elevation', staticValue('elevation', index))} · 建成地 ${displayValue('built', staticValue('built', index))} · 树木类 ${displayValue('tree', staticValue('tree', index))}</p><div class="evidence-stat">合格观测 <strong>${summary.count} / 82</strong> 日期</div><p>年份：${distribution(summary.years)}<br>月份：${distribution(summary.months)}</p><div class="evidence-chart">${historyChart(rows)}</div><p>点按实际过境日期排列；短线表示无合格观测。无连线、插值或趋势。逐日数值与缺测状态见 CSV。</p><p>相对温差参照为同日 QA 可观测格网的固定非水土地面积加权中位数，不是真实全市中位数。地表温度不是气温、站点实测或人体热暴露；树木类比例不是实测遮阴。</p>${evidenceFooter()}</article>`;
}

async function expandHistory(index) {
  const generation = state.selectionGeneration;
  state.historyExpanded = true;
  renderInspector();
  try {
    const identity = identityAt(index);
    const block = await ensureHistoryBlock(identity.block);
    if (generation !== state.selectionGeneration || state.selected !== index) return;
    state.historyData = { index, rows: historyRows(block.get(identity.slot), state.meta.dates) };
    renderInspector();
  } catch (error) {
    if (generation !== state.selectionGeneration) return;
    state.historyError = error.message;
    renderInspector();
  }
}

async function ensureInspectorStatic(index) {
  const generation = state.selectionGeneration;
  const ids = layers.filter(layer => layer.group === '土地与地形').map(layer => layer.id);
  await Promise.all(ids.map(id => ensureLayer(id, state.date)));
  if (generation === state.selectionGeneration && state.selected === index) renderInspector();
}

function comparisonChart(rows) {
  const valid = rows.filter(row => row.status === 'both');
  const timestamps = rows.map(row => Date.parse(`${row.date}T00:00:00Z`));
  const start = Math.min(...timestamps);
  const span = Math.max(...timestamps) - start || 1;
  const x = date => 34 + (Date.parse(`${date}T00:00:00Z`) - start) / span * 540;
  const extent = Math.max(1, ...valid.map(row => Math.abs(row.difference)));
  const y = difference => 66 - difference / extent * 43;
  const dots = valid.map(row => `<circle cx="${x(row.date).toFixed(1)}" cy="${y(row.difference).toFixed(1)}" r="3" fill="${row.difference >= 0 ? '#f6b46d' : '#8fd1ce'}"><title>${row.date} ${displayValue('relative', row.difference)}</title></circle>`).join('');
  return `<svg viewBox="0 0 610 140" role="img" aria-label="共同有效日期的 A 减 B 地表温差散点；无连线或插值"><path d="M34 15v101h540" fill="none" stroke="#8fa5a0"/><path d="M34 66h540" stroke="#a5bcb5" stroke-dasharray="3 3"/><text x="0" y="69">0°</text>${dots}<text x="34" y="135">2021</text><text x="539" y="135">2024</text></svg>`;
}

function comparisonEvidenceCard(a, b, rows) {
  const summary = comparisonSummary(rows);
  const location = (label, index) => `<p>${label}：${identityAt(index).id} · 250 m 固定格网<br>WGS84 ${state.coords[index * 2 + 1].toFixed(5)}°N, ${state.coords[index * 2].toFixed(5)}°E<br>高程 ${displayValue('elevation', staticValue('elevation', index))} · 建成地 ${displayValue('built', staticValue('built', index))} · 树木类 ${displayValue('tree', staticValue('tree', index))}</p>`;
  const overall = summary.sharedCount === 0 ? '无法进行同日比较。' : `共同日期等权 A−B 中位数 ${displayValue('relative', summary.median)}；A 较热 ${summary.aWarmerCount} / ${summary.sharedCount} 天，相等 ${summary.equalCount} 天。${summary.sharedCount === 1 ? '仅一个共同日期，不作重复性结论。' : ''}`;
  return `<article class="evidence-card"><div class="evidence-heading">成都地表热地图 / 观测证据卡</div><h1>两地点同日比较</h1><div class="evidence-places">${location('A', a)}${location('B', b)}</div><div class="evidence-stat">共同有效 <strong>${summary.sharedCount} / 82</strong> 日期 · A ${summary.aCount} · B ${summary.bCount}</div><p>共同日期年份：${distribution(summary.years)}<br>共同日期月份：${distribution(summary.months)}</p><p>${overall}</p>${summary.sharedCount ? `<div class="evidence-chart">${comparisonChart(rows)}</div>` : ''}<p>ΔT = A、B 同一物理日期的 QA 合格地表温度中位数之差。图中只有独立日期的点，没有连线、插值或趋势；82 日期逐日状态见 CSV。</p><p>同日比较减少日期天气差异，但不能控制高程、土地类型或有效像元构成。它不是气温差、站点实测、遮阴因果效果、人体热暴露或治理优先级。</p>${evidenceFooter()}</article>`;
}

function comparisonLocation(label, index) {
  if (index < 0) return `<div class="compare-location empty"><strong>${label} · 尚未选格</strong><span>在地图点选，或输入 WGS84 纬度、经度定位</span></div>`;
  const identity = identityAt(index);
  const field = id => displayValue(id, staticValue(id, index));
  return `<div class="compare-location"><strong>${label} · ${identity.id}</strong><span>${state.coords[index * 2 + 1].toFixed(5)}°N, ${state.coords[index * 2].toFixed(5)}°E</span><span>高程 ${field('elevation')} · 建成地 ${field('built')} · 树木类 ${field('tree')}</span><span>有效日期 ${state.support[index * 2]} / 82</span></div>`;
}

function renderComparisonPanel(target) {
  const { a, b, pick } = state.comparison;
  const rows = state.comparisonData?.a === a && state.comparisonData?.b === b ? state.comparisonData.rows : null;
  const summary = rows ? comparisonSummary(rows) : null;
  const table = rows?.map(row => `<tr class="${row.status === 'both' ? '' : 'missing'}"><td>${row.date}</td><td>${row.a === null ? '缺测' : displayValue('observed', row.a)}</td><td>${row.b === null ? '缺测' : displayValue('observed', row.b)}</td><td>${row.difference === null ? '—' : displayValue('relative', row.difference)}</td><td>${row.aQa === null ? '—' : `${row.aQa}%`}</td><td>${row.bQa === null ? '—' : `${row.bQa}%`}</td></tr>`).join('');
  target.innerHTML = `<button class="inspector-close" id="compare-close" aria-label="退出两地比较">×</button>
    <span class="inspector-kicker">TWO GRID / SAME OVERPASS</span><h2>两地点同日比较</h2>
    <p>点选或 WGS84 定位选择 <strong>${pick}</strong>；A、B 必须是不同的正土地格网。</p>
    <div class="compare-picks"><button id="compare-pick-a" class="${pick === 'A' ? 'active' : ''}" type="button">下次选 A</button><button id="compare-pick-b" class="${pick === 'B' ? 'active' : ''}" type="button">下次选 B</button><button id="compare-swap" type="button" ${a < 0 || b < 0 ? 'disabled' : ''}>交换 A/B</button><button id="compare-clear" type="button">清除</button></div>
    ${comparisonLocation('A', a)}${comparisonLocation('B', b)}
    ${a < 0 || b < 0 ? '<p class="compare-message">选齐 A、B 后读取各自空间块；没有观测的格网也可比较缺测状态。</p>'
      : state.comparisonError ? `<p class="compare-message">读取失败：${state.comparisonError}</p>`
        : !rows ? '<p class="compare-message">正在按空间块读取两格历史记录…</p>'
          : `<div class="compare-summary"><strong>${summary.sharedCount} / 82</strong> 个共同有效日期<br>A 有效 ${summary.aCount} · B 有效 ${summary.bCount}<br>仅 A ${summary.aOnlyCount} · 仅 B ${summary.bOnlyCount} · 均无 ${summary.neitherCount}<br>共同日期年份：${distribution(summary.years)}<br>共同日期月份：${distribution(summary.months)}</div>
            ${summary.sharedCount === 0 ? '<p class="compare-message">无法进行同日比较。</p>' : `<div class="compare-keyline">共同日期等权温差中位数 <strong>${displayValue('relative', summary.median)}</strong><br>A 较热 <strong>${summary.aWarmerCount} / ${summary.sharedCount}</strong> 天；相等 ${summary.equalCount} 天</div>${summary.sharedCount === 1 ? '<p class="compare-message">仅一个共同日期，只描述该次观测，不作重复性结论。</p>' : ''}`}
            ${summary.sharedCount ? `<div class="history-chart">${comparisonChart(rows)}<small>点为同日均有效时的 A − B；不连线、不插值。82 日期的缺测状态见下表。</small></div>` : ''}
            <div class="evidence-actions"><button id="compare-csv" type="button">下载82日期 CSV</button><button id="compare-print" type="button">打印证据卡 / 保存 PDF</button></div>
            <div class="history-table-wrap"><table><thead><tr><th>日期</th><th>A 温度</th><th>B 温度</th><th>A − B</th><th>A 有效像元</th><th>B 有效像元</th></tr></thead><tbody>${table}</tbody></table></div>`}
    <small>同日比较减少日期天气差异，不能控制高程、土地类型或有效像元构成。数值是两个 250 m 格网的 QA 合格地表温度中位数差，不是站台实测、气温差、遮阴因果效果或人体热暴露；树木类比例不能证明降温原因。</small>`;
  target.classList.remove('hidden');
  $('compare-close').addEventListener('click', () => toggleComparison(false));
  $('compare-pick-a').addEventListener('click', () => { state.comparison.pick = 'A'; renderInspector(); saveView(); });
  $('compare-pick-b').addEventListener('click', () => { state.comparison.pick = 'B'; renderInspector(); saveView(); });
  $('compare-swap').addEventListener('click', () => {
    [state.comparison.a, state.comparison.b] = [state.comparison.b, state.comparison.a];
    state.comparison.pick = 'B';
    beginComparisonLoad();
  });
  $('compare-clear').addEventListener('click', () => {
    state.comparison.a = -1;
    state.comparison.b = -1;
    state.comparison.pick = 'A';
    beginComparisonLoad();
  });
  $('compare-csv')?.addEventListener('click', () => {
    downloadCsv(`chengdu_compare_${a}_${b}.csv`, twoGridCsv({ aId: identityAt(a).id, bId: identityAt(b).id, rows }));
  });
  $('compare-print')?.addEventListener('click', () => printEvidence(comparisonEvidenceCard(a, b, rows)));
}

async function loadComparison(generation) {
  const { a, b } = state.comparison;
  if (a < 0 || b < 0) return;
  try {
    const aId = identityAt(a);
    const bId = identityAt(b);
    const [aBlock, bBlock] = await Promise.all([ensureHistoryBlock(aId.block), ensureHistoryBlock(bId.block)]);
    if (generation !== state.comparisonGeneration || !state.comparison.enabled) return;
    state.comparisonData = { a, b, rows: comparisonRows(aBlock.get(aId.slot), bBlock.get(bId.slot), state.meta.dates) };
    renderInspector();
  } catch (error) {
    if (generation !== state.comparisonGeneration) return;
    state.comparisonError = error.message;
    renderInspector();
  }
}

function beginComparisonLoad() {
  const generation = ++state.comparisonGeneration;
  state.comparisonData = null;
  state.comparisonError = null;
  renderInspector();
  heatLayer.redraw();
  saveView();
  void loadComparison(generation);
}

function selectComparisonGrid(index) {
  if (index < 0 || !state.applicable[index]) throw new Error('请选择技术研究范围内的正土地格网');
  const other = state.comparison.pick === 'A' ? state.comparison.b : state.comparison.a;
  if (index === other) throw new Error('A、B 必须是不同格网；请选择另一位置');
  state.comparison[state.comparison.pick.toLowerCase()] = index;
  if (state.comparison.pick === 'A') state.comparison.pick = 'B';
  beginComparisonLoad();
}

function toggleComparison(enabled = !state.comparison.enabled) {
  state.comparison.enabled = enabled;
  $('compare-mode').textContent = enabled ? '退出比较' : '两地比较';
  if (enabled && state.comparison.a < 0 && state.selected >= 0 && state.applicable[state.selected]) {
    state.comparison.a = state.selected;
    state.comparison.pick = 'B';
  }
  ++state.comparisonGeneration;
  renderInspector();
  heatLayer.redraw();
  saveView();
  if (enabled) void loadComparison(state.comparisonGeneration);
}

function renderInspector() {
  const target = $('inspector');
  target.classList.toggle('compare', state.comparison.enabled);
  if (state.comparison.enabled) { renderComparisonPanel(target); return; }
  if (state.selected < 0) { target.classList.add('hidden'); return; }
  const index = state.selected;
  const value = valueAt(index);
  const identity = identityAt(index);
  const obs = state.dates.get(state.date)?.temperature[index] ?? -32768;
  const observedValue = decodeValue('observed', obs);
  const staticIds = layers.filter(layer => layer.group === '土地与地形').map(layer => layer.id);
  const staticRows = state.applicable[index]
    ? staticIds.map(id => `<div><span>${layerById.get(id).label}</span><strong>${state.static.has(id) ? displayValue(id, staticValue(id, index)) : '加载中…'}</strong></div>`).join('')
    : '<div><span>土地支持</span><strong>无适用非水土地</strong></div>';
  target.innerHTML = `
    <button class="inspector-close" id="close-inspector" aria-label="关闭格网信息">×</button>
    <span class="inspector-kicker">250 M GRID · ${identity.id}</span>
    <h2>${state.applicable[index] ? displayValue(state.layer, value) : '不适用'}</h2>
    <p>${layerById.get(state.layer).label} · ${dataStatus({ inRange: true, applicable: Boolean(state.applicable[index]), layer: state.layer, value })}</p>
    <div class="inspector-grid"><div><span>${state.date} 地表温度</span><strong>${state.applicable[index] ? observedValue === null ? '当日无合格记录' : displayValue('observed', observedValue) : '不适用'}</strong></div><div><span>合格日期</span><strong>${state.support[index * 2]} / 82</strong></div><div><span>WGS84 格网中心</span><strong>${state.coords[index * 2 + 1].toFixed(5)}°N<br>${state.coords[index * 2].toFixed(5)}°E</strong></div><div><span>土地状态</span><strong>${state.applicable[index] ? '正土地格网' : '无适用土地'}</strong></div></div>
    <details class="static-details" ${state.staticExpanded ? 'open' : ''}><summary>查看全部静态特征</summary><div class="inspector-grid">${staticRows}</div></details>
    ${state.applicable[index] ? `<button type="button" class="history-toggle" id="history-toggle">${state.historyExpanded ? '收起' : '展开'} 82 次历史观测</button>${state.historyExpanded ? `<div class="history-content">${state.historyError ? `<p>${state.historyError}</p>` : historyMarkup(index)}</div>` : ''}` : ''}
    <small>单格是卫星与公开数据的格网汇总，并非站点实测或人体热暴露。零值与缺失分开显示。</small>`;
  target.classList.remove('hidden');
  $('close-inspector').addEventListener('click', () => { state.selected = -1; ++state.selectionGeneration; renderInspector(); heatLayer.redraw(); saveView(); });
  target.querySelector('.static-details').addEventListener('toggle', event => {
    state.staticExpanded = event.target.open;
    if (event.target.open && staticIds.some(id => !state.static.has(id))) ensureInspectorStatic(index).catch(showError);
  });
  $('history-toggle')?.addEventListener('click', () => {
    if (state.historyExpanded) { state.historyExpanded = false; renderInspector(); }
    else expandHistory(index);
  });
  $('single-csv')?.addEventListener('click', () => {
    const rows = state.historyData.rows;
    downloadCsv(`chengdu_history_${identity.id}.csv`, singleHistoryCsv({ gridId: identity.id, lat: state.coords[index * 2 + 1], lon: state.coords[index * 2], rows }));
  });
  $('single-print')?.addEventListener('click', () => printEvidence(singleEvidenceCard(index)));
}

map.on('click', event => {
  if (!state.meta) return;
  if (state.comparison.enabled) {
    try {
      if (!inResearchBoundary(event.latlng, state.boundary)) throw new Error('研究范围外；无法选择比较格网');
      selectComparisonGrid(nearestGrid(event.latlng));
      $('outside-status').classList.add('hidden');
    } catch (error) {
      $('outside-status').textContent = error.message;
      $('outside-status').classList.remove('hidden');
    }
    return;
  }
  ++state.selectionGeneration;
  const inside = inResearchBoundary(event.latlng, state.boundary);
  state.selected = inside ? nearestGrid(event.latlng) : -1;
  state.historyExpanded = false;
  state.staticExpanded = false;
  state.historyData = null;
  state.historyError = null;
  $('outside-status').textContent = state.selected < 0
    ? inside ? '研究范围内未找到对应固定格网。' : '研究范围外；此处没有本地图的固定格网数据。'
    : '';
  $('outside-status').classList.toggle('hidden', state.selected >= 0);
  renderInspector();
  heatLayer.redraw();
  saveView();
});

$('compare-mode').addEventListener('click', () => toggleComparison());
$('reset-view').addEventListener('click', () => map.fitBounds([[29.6, 102.8], [31.5, 105.5]], { padding: [25, 25] }));
$('layer-opacity').addEventListener('input', event => {
  state.opacity = Number(event.target.value) / 100;
  $('opacity-value').textContent = `${event.target.value}%`;
  heatLayer.redraw();
  saveView();
});
$('coordinate-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const coordinate = parseWgs84($('coordinate-input').value);
    const role = state.comparison.pick;
    if (state.comparison.enabled) {
      if (!inResearchBoundary({ lat: coordinate.lat, lon: coordinate.lon }, state.boundary)) throw new Error('研究范围外；无法选择比较格网');
      selectComparisonGrid(nearestGrid({ lat: coordinate.lat, lng: coordinate.lon }));
    }
    map.setView([coordinate.lat, coordinate.lon], Math.max(map.getZoom(), 12));
    $('coordinate-status').textContent = state.comparison.enabled
      ? `已选 ${role}，WGS84：${coordinate.lat.toFixed(5)}, ${coordinate.lon.toFixed(5)}`
      : `已定位 WGS84：${coordinate.lat.toFixed(5)}, ${coordinate.lon.toFixed(5)}`;
  } catch (error) { $('coordinate-status').textContent = error.message; }
});
$('share-view').addEventListener('click', async () => {
  saveView();
  try {
    await navigator.clipboard.writeText(location.href);
    $('share-view').textContent = '已复制链接';
  } catch {
    $('share-view').textContent = '链接已在地址栏';
  }
  setTimeout(() => { $('share-view').textContent = '复制分享链接'; }, 2500);
});
map.on('moveend zoomend', saveView);
$('year-select').addEventListener('change', event => {
  const dates = state.meta.dates.filter(item => item.date.startsWith(event.target.value));
  selectDate(dates.at(-1).date);
});
$('date-select').addEventListener('change', event => selectDate(event.target.value));

async function start() {
  try {
    [state.meta, state.historyMeta] = await Promise.all([getJSON('manifest.json'), getJSON('history/manifest.json')]);
    if (state.meta.grid_count !== 231515 || state.meta.date_count !== 82) throw new Error('地图数据合同不一致');
    if (state.historyMeta.date_count !== 82 || state.historyMeta.grid_count !== state.meta.grid_count || state.historyMeta.observed_records !== state.meta.observed_grid_date_records || state.historyMeta.date_order.some((date, i) => date !== state.meta.dates[i].date)) throw new Error('历史数据与地图日期不一致');
    const [coordinateBuffer, applicableBuffer, supportBuffer, weatherIndexBuffer, latticeBuffer, boundary] = await Promise.all([
      getBuffer('grids.bin'), getBuffer('applicable.bin'), getBuffer('support.bin'), getBuffer('weather-index.bin'), getBuffer('history/grid-lattice.bin'), getJSON('history/technical-boundary.geojson'),
    ]);
    const count = state.meta.grid_count;
    if (coordinateBuffer.byteLength !== count * 8 || applicableBuffer.byteLength !== count || supportBuffer.byteLength !== count * 2 || weatherIndexBuffer.byteLength !== count * 2 || latticeBuffer.byteLength !== count * 4) throw new Error('基础格网文件长度不符');
    state.coords = new Float32Array(coordinateBuffer);
    state.applicable = new Uint8Array(applicableBuffer);
    state.support = new Uint8Array(supportBuffer);
    state.weatherIndex = new Uint16Array(weatherIndexBuffer);
    state.lattice = new Uint16Array(latticeBuffer);
    state.mercatorX = new Float64Array(count);
    state.mercatorY = new Float64Array(count);
    for (let index = 0; index < count; index++) {
      const lon = state.coords[index * 2];
      const lat = state.coords[index * 2 + 1] * Math.PI / 180;
      state.mercatorX[index] = (lon + 180) / 360;
      state.mercatorY[index] = .5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI);
    }
    const restored = decodeView(location.search, layerById, new Set(state.meta.dates.map(item => item.date)), count);
    state.date = restored.date || state.meta.initial_date;
    state.layer = restored.layer || 'relative';
    state.opacity = restored.opacity ?? .86;
    state.selected = restored.selected;
    state.comparison = restored.comparison;
    if (!state.applicable[state.comparison.a]) state.comparison.a = -1;
    if (!state.applicable[state.comparison.b] || state.comparison.a === state.comparison.b) state.comparison.b = -1;
    $('compare-mode').textContent = state.comparison.enabled ? '退出比较' : '两地比较';
    $('layer-opacity').value = String(Math.round(state.opacity * 100));
    $('opacity-value').textContent = `${Math.round(state.opacity * 100)}%`;
    if (restored.center) map.setView([restored.center.lat, restored.center.lon], restored.zoom ?? 10);
    else if (restored.zoom !== null) map.setZoom(restored.zoom);
    map.createPane('researchBoundary');
    map.getPane('researchBoundary').style.zIndex = '440';
    map.getPane('researchBoundary').style.pointerEvents = 'none';
    L.geoJSON(boundary, { pane: 'researchBoundary', interactive: false, style: { color: '#1b3437', weight: 2, opacity: .9, fill: false, dashArray: '7 5' } }).addTo(map);
    state.boundary = boundary.features[0].geometry;
    renderLayerList();
    renderYearDateControls();
    updateLabels();
    await Promise.all([
      ensureLayer(state.layer, state.date),
      ensureDate(state.date),
      ...['built','tree','elevation'].map(id => ensureLayer(id, state.date)),
    ]);
    $('map-loading').classList.add('hidden');
    heatLayer.redraw();
    renderInspector();
    saveView();
    if (state.comparison.enabled) void loadComparison(state.comparisonGeneration);
  } catch (error) { showError(error); }
}

start();
