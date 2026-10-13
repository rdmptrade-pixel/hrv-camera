// Спектральный анализ интервалов между ударами. Без обращений к браузеру.
// Метод Ломба–Скаргла: работает прямо по неравномерным точкам, поэтому выкинутые
// (отбракованные) интервалы не требуют подстановок.

export const SPECTRUM = {
  STEP_HZ: 0.001, // шаг по частоте
  // Диапазоны частот — общепринятые для 5-минутной записи
  VLF: [0.003, 0.04], // очень медленные волны
  LF: [0.04, 0.15], // медленные волны (вазомоторный центр)
  HF: [0.15, 0.4], // дыхательные волны (парасимпатика)
}

/**
 * Периодограмма Ломба–Скаргла.
 * @param {number[]} t — моменты, с
 * @param {number[]} y — значения (интервалы, мс)
 * @param {number[]} freqs — частоты, Гц
 * @returns {number[]} мощность на каждой частоте
 */
export function lomb(t, y, freqs) {
  const m = y.reduce((a, v) => a + v, 0) / y.length
  const yc = y.map((v) => v - m)
  return freqs.map((f) => {
    const w = 2 * Math.PI * f
    let s2 = 0
    let c2 = 0
    for (const ti of t) {
      s2 += Math.sin(2 * w * ti)
      c2 += Math.cos(2 * w * ti)
    }
    const tau = Math.atan2(s2, c2) / (2 * w)
    let yC = 0
    let yS = 0
    let cc = 0
    let ss = 0
    for (let i = 0; i < t.length; i++) {
      const c = Math.cos(w * (t[i] - tau))
      const s = Math.sin(w * (t[i] - tau))
      yC += yc[i] * c
      yS += yc[i] * s
      cc += c * c
      ss += s * s
    }
    return 0.5 * ((yC * yC) / cc + (yS * yS) / ss)
  })
}

/**
 * Доли мощности VLF, LF, HF (в % от суммы трёх — как TP = VLF + LF + HF в патенте RU 2448644).
 * @param {number[]} t — моменты окончания интервалов, с
 * @param {number[]} nn — очищенные интервалы, мс
 * @returns {{vlfPct:number, lfPct:number, hfPct:number}}
 */
export function bandShares(t, nn, cfg = SPECTRUM) {
  if (nn.length < 30) return { vlfPct: NaN, lfPct: NaN, hfPct: NaN }
  const freqs = []
  for (let f = cfg.VLF[0]; f < cfg.HF[1]; f += cfg.STEP_HZ) freqs.push(f)
  const p = lomb(t, nn, freqs)
  const band = ([lo, hi]) => freqs.reduce((a, f, i) => (f >= lo && f < hi ? a + p[i] : a), 0)
  const vlf = band(cfg.VLF)
  const lf = band(cfg.LF)
  const hf = band(cfg.HF)
  const tp = vlf + lf + hf
  return { vlfPct: (vlf / tp) * 100, lfPct: (lf / tp) * 100, hfPct: (hf / tp) * 100 }
}
