export function gridIdentity(column, row) {
  const easting = 307500 + column * 250;
  const northing = 3478750 - row * 250;
  const blockE = Math.floor((easting - 125) / 10000);
  const blockN = Math.floor((northing - 125) / 10000);
  const slot = Math.floor((northing - 125 - blockN * 10000) / 250) * 40
    + Math.floor((easting - 125 - blockE * 10000) / 250);
  return { id: `g250_e${easting - 125}_n${northing - 125}`, block: `b10k_e${blockE}_n${blockN}`, slot };
}

export function decodeBlock(buffer, dates) {
  const view = new DataView(buffer);
  const bySlot = new Map();
  let offset = 0;
  for (let dateIndex = 0; dateIndex < dates.length; dateIndex++) {
    if (offset + 2 > view.byteLength) throw new Error('历史文件日期头不完整');
    const count = view.getUint16(offset, true);
    offset += 2;
    let previous = -1;
    for (let record = 0; record < count; record++) {
      if (offset + 5 > view.byteLength) throw new Error('历史文件观测记录不完整');
      const slot = view.getUint16(offset, true);
      const temperature = view.getInt16(offset + 2, true);
      const qa = view.getUint8(offset + 4);
      offset += 5;
      if (slot <= previous || slot >= 1600 || temperature === -32768 || qa > 100) {
        throw new Error('历史文件键或数值编码无效');
      }
      previous = slot;
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push({ dateIndex, temperature, qa });
    }
  }
  if (offset !== view.byteLength) throw new Error('历史文件尾部长度不符');
  return bySlot;
}

export function historyRows(records, dates) {
  const byDate = new Map((records || []).map(row => [row.dateIndex, row]));
  return dates.map((date, dateIndex) => {
    const record = byDate.get(dateIndex);
    if (!record) return { date: date.date, observed: null, relative: null, qa: null };
    const observed = record.temperature / 100;
    return {
      date: date.date,
      observed,
      relative: observed - date.observed_area_weighted_median_c,
      qa: record.qa,
    };
  });
}

export function historySummary(rows) {
  const observed = rows.filter(row => row.observed !== null);
  const years = {};
  const months = {};
  for (const row of observed) {
    const year = row.date.slice(0, 4);
    const month = row.date.slice(5, 7);
    years[year] = (years[year] || 0) + 1;
    months[month] = (months[month] || 0) + 1;
  }
  return { count: observed.length, years, months };
}

export function comparisonRows(aRecords, bRecords, dates) {
  const aByDate = new Map((aRecords || []).map(record => [record.dateIndex, record]));
  const bByDate = new Map((bRecords || []).map(record => [record.dateIndex, record]));
  return dates.map((date, dateIndex) => {
    const a = aByDate.get(dateIndex);
    const b = bByDate.get(dateIndex);
    const status = a && b ? 'both' : a ? 'a_only' : b ? 'b_only' : 'neither';
    return {
      date: date.date,
      status,
      a: a ? a.temperature / 100 : null,
      b: b ? b.temperature / 100 : null,
      difference: a && b ? (a.temperature - b.temperature) / 100 : null,
      aQa: a ? a.qa : null,
      bQa: b ? b.qa : null,
    };
  });
}

export function comparisonSummary(rows) {
  const shared = rows.filter(row => row.status === 'both');
  const differences = shared.map(row => row.difference).sort((a, b) => a - b);
  const middle = Math.floor(differences.length / 2);
  const median = differences.length === 0 ? null : differences.length % 2
    ? differences[middle]
    : (differences[middle - 1] + differences[middle]) / 2;
  const years = {};
  const months = {};
  for (const row of shared) {
    const year = row.date.slice(0, 4);
    const month = row.date.slice(5, 7);
    years[year] = (years[year] || 0) + 1;
    months[month] = (months[month] || 0) + 1;
  }
  return {
    aCount: rows.filter(row => row.a !== null).length,
    bCount: rows.filter(row => row.b !== null).length,
    sharedCount: shared.length,
    aOnlyCount: rows.filter(row => row.status === 'a_only').length,
    bOnlyCount: rows.filter(row => row.status === 'b_only').length,
    neitherCount: rows.filter(row => row.status === 'neither').length,
    aWarmerCount: shared.filter(row => row.difference > 0).length,
    equalCount: shared.filter(row => row.difference === 0).length,
    median,
    years,
    months,
  };
}

export function parseWgs84(input) {
  const parts = input.trim().split(/[\s,，]+/);
  if (parts.length !== 2 || parts.some(part => part === '' || !Number.isFinite(Number(part)))) {
    throw new Error('请输入纬度、经度两个数字，例如 30.67, 104.06');
  }
  const [lat, lon] = parts.map(Number);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('WGS84 范围：纬度 −90～90，经度 −180～180');
  }
  return { lat, lon };
}

export function encodeView({ layer, date, center, zoom, selected, opacity, comparison }) {
  const params = new URLSearchParams();
  params.set('layer', layer);
  params.set('date', date);
  params.set('lat', center.lat.toFixed(5));
  params.set('lon', center.lng.toFixed(5));
  params.set('z', zoom.toFixed(2));
  params.set('a', opacity.toFixed(2));
  if (selected >= 0) params.set('grid', String(selected));
  if (comparison?.enabled) {
    params.set('compare', '1');
    if (comparison.a >= 0) params.set('gridA', String(comparison.a));
    if (comparison.b >= 0) params.set('gridB', String(comparison.b));
    params.set('pick', comparison.pick === 'B' ? 'B' : 'A');
  }
  return params.toString();
}

export function decodeView(search, validLayers, validDates, gridCount) {
  const params = new URLSearchParams(search);
  const number = key => params.has(key) ? Number(params.get(key)) : null;
  const lat = number('lat');
  const lon = number('lon');
  const zoom = number('z');
  const opacity = number('a');
  const selected = number('grid');
  const validGrid = value => Number.isInteger(value) && value >= 0 && value < gridCount ? value : -1;
  const a = validGrid(number('gridA'));
  const b = validGrid(number('gridB'));
  return {
    layer: validLayers.has(params.get('layer')) ? params.get('layer') : null,
    date: validDates.has(params.get('date')) ? params.get('date') : null,
    center: Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null,
    zoom: Number.isFinite(zoom) && zoom >= 7 && zoom <= 15 ? zoom : null,
    opacity: Number.isFinite(opacity) && opacity >= 0.1 && opacity <= 1 ? opacity : null,
    selected: validGrid(selected),
    comparison: {
      enabled: params.get('compare') === '1',
      a,
      b: b === a ? -1 : b,
      pick: params.get('pick') === 'B' ? 'B' : 'A',
    },
  };
}

export function dataStatus({ inRange, applicable, layer, value }) {
  if (!inRange) return '研究范围外';
  if (!applicable) return '无适用土地';
  if (value !== null && Number.isFinite(value)) return value === 0 ? '有效数值为零' : '有有效数值';
  if (['relative', 'observed', 'qa'].includes(layer)) return '当日没有合格温度记录';
  if (['date-count', 'year-count'].includes(layer)) return '特征来源缺失';
  return '特征来源缺失';
}

function ringContains(point, ring) {
  let inside = false;
  const longitude = point.lng ?? point.lon;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crossing = (yi > point.lat) !== (yj > point.lat)
      && longitude < (xj - xi) * (point.lat - yi) / (yj - yi) + xi;
    if (crossing) inside = !inside;
  }
  return inside;
}

export function inResearchBoundary(point, geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.some(rings => ringContains(point, rings[0])
    && !rings.slice(1).some(ring => ringContains(point, ring)));
}
