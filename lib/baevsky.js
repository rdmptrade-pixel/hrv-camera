// Метод Баевского (вариационная пульсометрия) и стандартные показатели вариабельности.
// На вход — очищенные интервалы между ударами (мс).

export const BAEVSKY = {
  BIN_MS: 50, // ширина столбца гистограммы — классический шаг метода
  MIN_INTERVALS: 100, // меньше — индекс ненадёжен
  // Ориентиры для взрослого в покое (условные единицы)
  ZONES: [
    { max: 50, label: 'преобладает расслабление (ваготония)' },
    { max: 150, label: 'норма' },
    { max: 500, label: 'напряжение' },
    { max: Infinity, label: 'перенапряжение' },
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
    histogram: [...bins.entries()].sort((a, b) => a[0] - b[0]),
  }
}
