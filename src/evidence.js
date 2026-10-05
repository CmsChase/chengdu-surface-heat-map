const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = (headers, rows) => `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
const degrees = value => value === null ? '' : value.toFixed(2);
const percent = value => value === null ? '' : String(value);

export function singleHistoryCsv({ gridId, lat, lon, rows }) {
  return csv(
    ['格网标识', 'WGS84纬度_度', 'WGS84经度_度', '物理过境日期', '观测状态', '绝对地表温度_摄氏度', '同日相对温差_摄氏度', '有效土地像元比例_百分比'],
    rows.map(row => [gridId, lat.toFixed(5), lon.toFixed(5), row.date, row.observed === null ? '无合格观测' : '有效观测', degrees(row.observed), degrees(row.relative), percent(row.qa)]),
  );
}

const comparisonStatus = { both: '共同有效', a_only: '仅A有效', b_only: '仅B有效', neither: '两者均无观测' };

export function twoGridCsv({ aId, bId, rows }) {
  return csv(
    ['A格网标识', 'B格网标识', '物理过境日期', '共同观测状态', 'A绝对地表温度_摄氏度', 'B绝对地表温度_摄氏度', 'A减B_摄氏度', 'A有效土地像元比例_百分比', 'B有效土地像元比例_百分比'],
    rows.map(row => [aId, bId, row.date, comparisonStatus[row.status], degrees(row.a), degrees(row.b), degrees(row.difference), percent(row.aQa), percent(row.bQa)]),
  );
}
