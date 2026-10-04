export const layers = [
  { id: 'relative', label: '同日相对温差', group: '卫星温度', unit: '°C', min: -12, max: 12, colors: ['#284d6d','#81a7b5','#f0e9d7','#e89a61','#a13937'], detail: '相对当日 QA 合格格网的面积加权中位数' },
  { id: 'observed', label: '观测地表温度', group: '卫星温度', unit: '°C', min: 5, max: 55, colors: ['#2e5670','#adc0bb','#e9d39f','#db8051','#922e3d'], detail: 'Landsat QA 合格白天地表温度' },
  { id: 'qa', label: '有效土地像元比例', group: '观测支持', unit: '%', min: 0, max: 100, colors: ['#e4ddd1','#adc6b8','#447f7e'], detail: '当日有效热像元 / 格网固定非水土地像元' },
  { id: 'date-count', label: '合格观测日期数', group: '观测支持', unit: '天', min: 0, max: 45, colors: ['#eee9dc','#7cabb0','#1d5363'], detail: '2021–2024 年每格可用的独立日期数量' },
  { id: 'year-count', label: '覆盖年份数', group: '观测支持', unit: '年', min: 0, max: 4, colors: ['#eee9dc','#7cabb0','#1d5363'], detail: '2021–2024 年每格获得合格观测的年份数' },
  { id: 'built', label: '建成地比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f1ecdd','#d0a37b','#80534d'], detail: 'WorldCover 2020，固定非水土地分母' },
  { id: 'tree', label: '树木覆盖比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#95b697','#2e6955'], detail: 'WorldCover 2020 树木类，并非现场遮阴测量' },
  { id: 'crop', label: '农田比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#d2bc76','#857a31'], detail: 'WorldCover 2020，固定非水土地分母' },
  { id: 'grass', label: '草地比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#b7be7d','#658459'], detail: 'WorldCover 2020，固定非水土地分母' },
  { id: 'shrub', label: '灌木比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#b9c29c','#788c57'], detail: 'WorldCover 2020，固定非水土地分母' },
  { id: 'bare', label: '裸地比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#d8bb93','#a58364'], detail: 'WorldCover 2020，固定非水土地分母' },
  { id: 'snow', label: '冰雪比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#bfd2d7','#7096af'], detail: 'WorldCover 2020，固定非水土地分母' },
  { id: 'wetland', label: '湿地比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#94bdba','#4a7e78'], detail: 'WorldCover 2020，固定非水土地分母' },
  { id: 'mangrove', label: '红树林比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#92b5a4','#427869'], detail: 'WorldCover 2020；成都可能接近零' },
  { id: 'moss', label: '苔藓地衣比例', group: '土地与地形', unit: '%', min: 0, max: 100, colors: ['#f0ebdc','#b7baa0','#818d73'], detail: 'WorldCover 2020，固定非水土地分母' },
  { id: 'elevation', label: '地形高程', group: '土地与地形', unit: 'm', min: 400, max: 5000, colors: ['#e7e4d7','#adc4a7','#76979c','#766b88','#e3d7cd'], detail: 'SRTM 固定地形背景' },
  { id: 'slope', label: '地形坡度', group: '土地与地形', unit: '°', min: 0, max: 45, colors: ['#eee9db','#cdb18c','#8c6464'], detail: 'SRTM 米制坡度' },
  { id: 't2m_last_k', label: '背景气温', group: '天气背景', unit: '°C', min: 0, max: 40, colors: ['#3c6f84','#c1cbbd','#eed499','#c6754f'], detail: 'ERA5-Land 最近完整小时 2 m 气温，约 9 km' },
  { id: 't2m_prior24h_mean_k', label: '前24小时平均气温', group: '天气背景', unit: '°C', min: 0, max: 40, colors: ['#3c6f84','#c1cbbd','#eed499','#c6754f'], detail: 'ERA5-Land 前24小时 2 m 气温平均，约 9 km' },
  { id: 'd2m_last_k', label: '背景露点', group: '天气背景', unit: '°C', min: -5, max: 32, colors: ['#466d86','#92b9b5','#e4c9a8','#ba765e'], detail: 'ERA5-Land 最近完整小时 2 m 露点' },
  { id: 'u10_last_m_s', label: '东西向风速', group: '天气背景', unit: 'm/s', min: -8, max: 8, colors: ['#356a87','#d9e4db','#ad7861'], detail: 'ERA5-Land 10 m 东西向分量' },
  { id: 'v10_last_m_s', label: '南北向风速', group: '天气背景', unit: 'm/s', min: -8, max: 8, colors: ['#356a87','#d9e4db','#ad7861'], detail: 'ERA5-Land 10 m 南北向分量' },
  { id: 'ssrd_prior24h_j_m2', label: '前24小时太阳辐射', group: '天气背景', unit: 'MJ/m²', min: 0, max: 30, colors: ['#d9e0dd','#e8cd87','#b5673f'], detail: 'ERA5-Land 累计短波辐射，经冻结时次规则转换' },
  { id: 'tp_prior24h_m', label: '前24小时降水', group: '天气背景', unit: 'mm', min: 0, max: 50, colors: ['#ebe9df','#82b3c1','#275c82'], detail: 'ERA5-Land 累计降水；异常来源值保留缺失' },
];

export const layerById = new Map(layers.map(layer => [layer.id, layer]));
export const weatherFieldIds = ['t2m_last_k','t2m_prior24h_mean_k','d2m_last_k','u10_last_m_s','v10_last_m_s','ssrd_prior24h_j_m2','tp_prior24h_m'];

export function displayValue(id, value) {
  if (!Number.isFinite(value)) return '无数据';
  if (['built','tree','crop','grass','shrub','bare','snow','wetland','mangrove','moss','qa'].includes(id)) return `${value.toFixed(1)}%`;
  if (['date-count','year-count'].includes(id)) return `${Math.round(value)} ${id === 'date-count' ? '天' : '年'}`;
  if (id === 'elevation') return `${Math.round(value).toLocaleString('zh-CN')} m`;
  if (id === 'slope') return `${value.toFixed(1)}°`;
  if (id === 'relative') return `${value >= 0 ? '+' : ''}${value.toFixed(2)} °C`;
  if (id === 'ssrd_prior24h_j_m2') return `${value.toFixed(1)} MJ/m²`;
  if (id === 'tp_prior24h_m') return `${value.toFixed(2)} mm`;
  if (id.endsWith('_m_s')) return `${value.toFixed(2)} m/s`;
  return `${value.toFixed(2)} °C`;
}

export function decodeValue(id, encoded, reference = 0) {
  if (id === 'relative') return encoded === -32768 ? null : encoded / 100 - reference;
  if (id === 'observed') return encoded === -32768 ? null : encoded / 100;
  if (id === 'qa') return encoded === 255 ? null : encoded;
  if (['built','tree','crop','grass','shrub','bare','snow','wetland','mangrove','moss'].includes(id)) return encoded === -32768 ? null : encoded / 10;
  if (id === 'slope') return encoded === -32768 ? null : encoded / 100;
  if (id === 'elevation') return encoded === -32768 ? null : encoded;
  if (id.endsWith('_k')) return encoded == null ? null : encoded - 273.15;
  if (id === 'ssrd_prior24h_j_m2') return encoded == null ? null : encoded / 1e6;
  if (id === 'tp_prior24h_m') return encoded == null ? null : encoded * 1000;
  return encoded == null ? null : encoded;
}
