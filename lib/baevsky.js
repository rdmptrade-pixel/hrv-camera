// Метод Баевского (вариационная пульсометрия) и стандартные показатели вариабельности.
// На вход — очищенные интервалы между ударами (мс).

export const BAEVSKY = {
  BIN_MS: 50, // ширина столбца гистограммы — классический шаг метода
  MIN_INTERVALS: 100, // меньше — индекс ненадёжен
  // Цветная шкала ИН для взрослого в покое (условные единицы).
  // Из методички Баевского и соавт. (Вестник аритмологии, 2001, № 24, с. 79): «в норме ИН 80–150»;
  // небольшая нагрузка поднимает его в 1,5–2 раза; при постоянном напряжении в покое — 400–600.
  // Остальные границы — разметка приложения по этим ориентирам, не из методички.
  ZONES: [
    { max: 50, key: 'vago', color: '#4fc3f7', label: 'выраженное преобладание расслабления' },
    { max: 80, key: 'low', color: '#4db6ac', label: 'ниже нормы — ближе к расслаблению' },
    { max: 150, key: 'norm', color: '#43a047', label: 'норма' },
    { max: 300, key: 'tension', color: '#fdd835', label: 'умеренное напряжение' },
    { max: 500, key: 'strong', color: '#fb8c00', label: 'выраженное напряжение' },
    { max: Infinity, key: 'over', color: '#e53935', label: 'перенапряжение' },
  ],
}

/**
 * @param {number[]} nn — очищенные интервалы, мс
 * @returns {object} ИН и составляющие, пульс, SDNN, RMSSD, гистограмма
 */
export function baevsky(nn, cfg = BAEVSKY) {
  const n = nn.length
  if (n < 2) return { n }
  const mean = nn.reduce((a, b) => a + b, 0) / n
  const sdnn = Math.sqrt(nn.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1))
  let sq = 0
  for (let i = 1; i < n; i++) sq += (nn[i] - nn[i - 1]) ** 2
  const rmssd = Math.sqrt(sq / (n - 1))

  // Гистограмма с шагом 50 мс; столбцы выровнены по кратным 50
  const bins = new Map()
  for (const v of nn) {
    const b = Math.floor(v / cfg.BIN_MS) * cfg.BIN_MS
    bins.set(b, (bins.get(b) || 0) + 1)
  }
  let modeBin = null
  let modeCount = -1
  for (const [b, c] of bins) if (c > modeCount) [modeBin, modeCount] = [b, c]
  const mo = (modeBin + cfg.BIN_MS / 2) / 1000 // мода, с (середина столбца)
  const amo = (modeCount / n) * 100 // амплитуда моды, %
  const mxdmn = (Math.max(...nn) - Math.min(...nn)) / 1000 // вариационный размах, с
  const si = mxdmn > 0 ? amo / (2 * mo * mxdmn) : NaN
  const zone = cfg.ZONES.find((z) => si <= z.max)

  return {
    n,
    reliable: n >= cfg.MIN_INTERVALS,
    hr: 60000 / mean,
    meanRr: mean,
    sdnn,
    rmssd,
    mo,
    amo,
    mxdmn,
    si,
    zone: zone ? zone.label : '—',
    zoneKey: zone ? zone.key : null,
    color: zone ? zone.color : '#777',
    histogram: [...bins.entries()].sort((a, b) => a[0] - b[0]),
  }
}
