// Оценка шума камеры в моментах ударов и поправка показателей на него. Без обращений к браузеру.
//
// Модель: каждый найденный удар смещён случайно на e (разброс σ, независимо от соседних).
// Тогда интервал получает шум e_i − e_{i−1}, а разность соседних интервалов —
// e_i − 2e_{i−1} + e_{i−2}: её дисперсия 6σ², а связь соседних разностей −4σ².
// У настоящих колебаний ритма эта связь около нуля или положительная, поэтому
// σ² ≈ −(ковариация соседних разностей) / 4 — оценка скорее заниженная, то есть осторожная.
// Та же модель даёт шум в спектре интервалов: 2σ²·(1 − cos 2πfT), T — средний интервал, с.
// Проверка на записи владельца 12.10.2026: оценка σ ≈ 21 мс предсказывает уровень спектра
// выше 0,45 Гц 1645, в записи — 1705.

export const NOISE = {
  GOOD_MS: 10, // шум до 10 мс — поправки небольшие
  FAIR_MS: 20, // до 20 мс — показатели берутся с поправкой
  // выше 20 мс — оценка ненадёжна: волна слабая, нужен новый замер с более лёгким нажимом
}

// Разности соседних интервалов внутри непрерывных участков принятых интервалов
function successiveDiffs(rr, kept) {
  const runs = []
  let cur = []
  for (let i = 1; i < rr.length; i++) {
    if (kept[i] && kept[i - 1]) cur.push(rr[i] - rr[i - 1])
    else if (cur.length) {
      runs.push(cur)
      cur = []
    }
  }
  if (cur.length) runs.push(cur)
  return runs
}

/**
 * Разброс шума времени удара σ, мс.
 * @param {number[]} rr
 * @param {boolean[]} kept
 */
export function estimateNoise(rr, kept) {
  const runs = successiveDiffs(rr, kept)
  let v = 0
  let nv = 0
  let c = 0
  let nc = 0
  for (const d of runs) {
    for (let i = 0; i < d.length; i++) {
      v += d[i] * d[i]
      nv++
      if (i) {
        c += d[i] * d[i - 1]
        nc++
      }
    }
  }
  if (nv < 30 || nc < 30) return { sigma: NaN, diffVar: NaN }
  const diffVar = v / nv
  const cov1 = c / nc
  const s2 = Math.min(Math.max(0, -cov1 / 4), diffVar / 6)
  return { sigma: Math.sqrt(s2), diffVar }
}

// Нормальное распределение: доля |x| > a при разбросе s
function twoSidedTail(a, s) {
  if (!(s > 0)) return 0
  const z = a / s
  const t = 1 / (1 + 0.2316419 * z)
  const p = 0.3989423 * Math.exp((-z * z) / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return 2 * p
}

/**
 * Показатели с поправкой на шум.
 * @param {{sigma:number, diffVar:number}} noise
 * @param {number} sdnn — по камере, мс
 * @returns {{rmssd:number, sdnn:number, pnn50:number}}
 */
export function correctedTimeDomain(noise, sdnn) {
  const s2 = noise.sigma ** 2
  const dTrue = Math.max(0, noise.diffVar - 6 * s2) // дисперсия настоящих разностей соседних интервалов
  return {
    rmssd: Math.sqrt(dTrue),
    sdnn: Math.sqrt(Math.max(0, sdnn * sdnn - 2 * s2)),
    // pNN50 восстанавливается по модели нормального распределения разностей
    pnn50: twoSidedTail(50, Math.sqrt(dTrue)) * 100,
  }
}

/**
 * Сглаживание интервалов 1-2-1 внутри непрерывных участков: шум интервалов падает в 8 раз,
 * медленные колебания почти не меняются. Для гистограммы и индекса напряжения.
 * @returns {number[]} сглаженные принятые интервалы (в том же порядке, что принятые исходные)
 */
export function smoothedNN(rr, kept) {
  const out = []
  for (let i = 0; i < rr.length; i++) {
    if (!kept[i]) continue
    const prev = i > 0 && kept[i - 1] ? rr[i - 1] : null
    const next = i < rr.length - 1 && kept[i + 1] ? rr[i + 1] : null
    if (prev !== null && next !== null) out.push((prev + 2 * rr[i] + next) / 4)
    else out.push(rr[i])
  }
  return out
}

/**
 * Уровень доверия к замеру по шуму.
 * @returns {'good'|'fair'|'bad'}
 */
export function noiseLevel(sigma, cfg = NOISE) {
  if (!Number.isFinite(sigma)) return 'bad'
  if (sigma <= cfg.GOOD_MS) return 'good'
  if (sigma <= cfg.FAIR_MS) return 'fair'
  return 'bad'
}
