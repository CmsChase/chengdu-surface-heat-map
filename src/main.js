import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { layers, layerById, weatherFieldIds, decodeValue, displayValue } from './layers.js';
import { canvasFrame } from './map-geometry.js';

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
  $('date-info').innerHTML = date ? `<strong>${date.rows.toLocaleString('zh-CN')}</strong><span>格当日有合格观测 · 正土地格的 ${(date.rows / state.meta.positive_land_grid_count * 100).toFixed(1)}%<br>可观测子集参考中位数 ${date.observed_area_weighted_median_c.toFixed(2)} °C</span>` : '';
  $('map-footnote').textContent = ['relative','observed','qa'].includes(state.layer)
    ? `${state.date} · 仅显示该次过境的 QA 合格格网；空白为缺测。`
    : weatherFieldIds.includes(state.layer)
      ? `${state.date} · ERA5-Land 约 9 km 天气背景，不是 250 m 实测。`
      : '静态公开特征 · 全部固定正土地格网。';
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
  } catch (error) { showError(error); }
}

async function selectDate(date) {
  const generation = ++state.generation;
  state.date = date;
  renderYearDateControls();
  updateLabels();
  $('map-loading').classList.remove('hidden');
  try {
    await ensureLayer(state.layer, date);
    if (generation !== state.generation) return;
    $('map-loading').classList.add('hidden');
    heatLayer.redraw();
    renderInspector();
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
    context.globalAlpha = thermal ? .93 : .86;
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
    if (state.selected >= 0) {
      const index = state.selected;
      const x = state.mercatorX[index] * world - origin.x;
      const y = state.mercatorY[index] * world - origin.y;
      context.strokeStyle = '#142b2e';
      context.lineWidth = 2.5;
      context.strokeRect(x - Math.max(half, 5), y - Math.max(half, 5), Math.max(cell, 10), Math.max(cell, 10));
    }
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
    if (!state.applicable[index]) continue;
    const dlat = state.coords[index * 2 + 1] - lat;
    if (Math.abs(dlat) > .003) continue;
    const dlon = (state.coords[index * 2] - lon) * lonScale;
    const squared = dlat * dlat + dlon * dlon;
    if (squared < best) { best = squared; nearest = index; }
  }
  return Math.sqrt(best) * 111.2 <= .23 ? nearest : -1;
}

function renderInspector() {
  const target = $('inspector');
  if (state.selected < 0) { target.classList.add('hidden'); return; }
  const index = state.selected;
  const value = valueAt(index);
  const obs = state.dates.get(state.date)?.temperature[index];
  const built = state.static.get('built')?.[index];
  const tree = state.static.get('tree')?.[index];
  const elevation = state.static.get('elevation')?.[index];
  target.innerHTML = `
    <button class="inspector-close" id="close-inspector" aria-label="关闭格网信息">×</button>
    <span class="inspector-kicker">250 M GRID / ${state.date}</span>
    <h2>${displayValue(state.layer, value)}</h2>
    <p>${layerById.get(state.layer).label}</p>
    <div class="inspector-grid"><div><span>观测地表温度</span><strong>${displayValue('observed', decodeValue('observed', obs ?? -32768))}</strong></div><div><span>合格日期</span><strong>${state.support[index * 2]} / 82</strong></div><div><span>建成地</span><strong>${built === undefined ? '—' : displayValue('built', decodeValue('built', built))}</strong></div><div><span>树木类</span><strong>${tree === undefined ? '—' : displayValue('tree', decodeValue('tree', tree))}</strong></div><div><span>高程</span><strong>${elevation === undefined ? '—' : displayValue('elevation', decodeValue('elevation', elevation))}</strong></div><div><span>位置</span><strong>${state.coords[index * 2 + 1].toFixed(4)}°N<br>${state.coords[index * 2].toFixed(4)}°E</strong></div></div>
    <small>单格是卫星与公开数据的格网汇总，并非站点实测。</small>`;
  target.classList.remove('hidden');
  $('close-inspector').addEventListener('click', () => { state.selected = -1; renderInspector(); heatLayer.redraw(); });
}

map.on('click', event => {
  if (!state.meta) return;
  state.selected = nearestGrid(event.latlng);
  renderInspector();
  heatLayer.redraw();
});

$('reset-view').addEventListener('click', () => map.fitBounds([[29.6, 102.8], [31.5, 105.5]], { padding: [25, 25] }));
$('year-select').addEventListener('change', event => {
  const dates = state.meta.dates.filter(item => item.date.startsWith(event.target.value));
  selectDate(dates.at(-1).date);
});
$('date-select').addEventListener('change', event => selectDate(event.target.value));

async function start() {
  try {
    state.meta = await getJSON('manifest.json');
    if (state.meta.grid_count !== 231515 || state.meta.date_count !== 82) throw new Error('地图数据合同不一致');
    const [coordinateBuffer, applicableBuffer, supportBuffer, weatherIndexBuffer] = await Promise.all([
      getBuffer('grids.bin'), getBuffer('applicable.bin'), getBuffer('support.bin'), getBuffer('weather-index.bin'),
    ]);
    const count = state.meta.grid_count;
    if (coordinateBuffer.byteLength !== count * 8 || applicableBuffer.byteLength !== count || supportBuffer.byteLength !== count * 2 || weatherIndexBuffer.byteLength !== count * 2) throw new Error('基础格网文件长度不符');
    state.coords = new Float32Array(coordinateBuffer);
    state.applicable = new Uint8Array(applicableBuffer);
    state.support = new Uint8Array(supportBuffer);
    state.weatherIndex = new Uint16Array(weatherIndexBuffer);
    state.mercatorX = new Float64Array(count);
    state.mercatorY = new Float64Array(count);
    for (let index = 0; index < count; index++) {
      const lon = state.coords[index * 2];
      const lat = state.coords[index * 2 + 1] * Math.PI / 180;
      state.mercatorX[index] = (lon + 180) / 360;
      state.mercatorY[index] = .5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI);
    }
    state.date = state.meta.initial_date;
    renderLayerList();
    renderYearDateControls();
    updateLabels();
    await Promise.all([
      ensureDate(state.date),
      ...['built','tree','elevation'].map(id => ensureLayer(id, state.date)),
    ]);
    $('map-loading').classList.add('hidden');
    heatLayer.redraw();
  } catch (error) { showError(error); }
}

start();
