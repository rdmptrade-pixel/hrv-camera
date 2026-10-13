// Разбор всей записи сразу (после замера): от сырой яркости кадров до интервалов между ударами.
// Чистые функции без обращений к браузеру — проверяются на сервере.

export const OFFLINE = {
  SKIP_START_MS: 3000, // первые секунды палец устраивается — отбрасываем
  FINGER_MIN_RED: 100, // палец на камере: красный яркий…
  FINGER_RED_TO_GREEN: 1.8, // …и намного ярче зелёного
  GLITCH_GREEN_JUMP: 0.25, // скачок зелёного относительно соседей — сбойный кадр (блик, сдвиг пальца)
  GLITCH_RED_JUMP: 1.2, // одиночный скачок красного — тоже сбой
  STEP_MS: 10, // равномерная сетка после выравнивания времени кадров (100 точек в секунду)
  HIGHPASS_MS: 1200, // окно вычитания медленного дрейфа
  LOWPASS_MS: 70, // окно сглаживания (дважды). 50 мс давало ложные удары при сильном шуме; 70 мс + шаблон устойчиво (tools/test-offline.mjs)
  MIN_RR_MS: 300, // интервалы короче/длиннее — заведомо не удары
  REFRACTORY_SHARE: 0.6, // два удара ближе 60 % типичного интервала — один из них ложный (вторая волна)
  TYPICAL_RR_BEATS: 10, // типичный интервал — медиана по стольким соседним
  MAX_RR_MS: 2000,
  PEAK_WINDOW_MS: 5000, // окно для порога по силе удара
  PEAK_SHARE: 0.35, // удар засчитывается, если крутизна подъёма не меньше этой доли типичной
  LOCAL_MEDIAN_BEATS: 5, // для проверки интервала на скачок берём медиану соседних
  MAX_JUMP_SHARE: 0.2, // интервал отличается от соседних больше чем на 20 % — отбраковываем
  GAP_MS: 150, // разрыв между годными кадрами больше этого — участок без данных
  SPLINE: true, // кубический сплайн между кадрами вместо прямых отрезков
  TEMPLATE: true, // уточнять каждый удар сопоставлением с усреднённой формой волны
  TEMPLATE_FROM_MS: -150, // окно формы удара относительно найденного удара: от подножия…
  TEMPLATE_TO_MS: 250, // …до вершины
  TEMPLATE_MAX_SHIFT_MS: 60, // насколько можно сдвинуть удар при уточнении
  TEMPLATE_PASSES: 2, // сколько раз пересобирать форму и уточнять
  TEMPLATE_MIN_CORR: 0.5, // удар, плохо похожий на форму, не сдвигаем
}

// Естественный кубический сплайн через точки (xs, ys); возвращает функцию значения
function naturalSpline(xs, ys) {
  const n = xs.length
  const h = new Array(n - 1)
  for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i]
  const m = new Float64Array(n) // вторые производные в узлах
  if (n > 2) {
    const a = new Float64Array(n)
    const b = new Float64Array(n)
    const c = new Float64Array(n)
    const r = new Float64Array(n)
    b[0] = 1
    b[n - 1] = 1
    for (let i = 1; i < n - 1; i++) {
      a[i] = h[i - 1]
      b[i] = 2 * (h[i - 1] + h[i])
      c[i] = h[i]
      r[i] = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1])
    }
    // Прогонка
    for (let i = 1; i < n; i++) {
      const w = a[i] / b[i - 1]
      b[i] -= w * c[i - 1]
      r[i] -= w * r[i - 1]
    }
    m[n - 1] = r[n - 1] / b[n - 1]
    for (let i = n - 2; i >= 0; i--) m[i] = (r[i] - c[i] * m[i + 1]) / b[i]
  }
  let k = 0
  return (x) => {
    while (k < n - 2 && xs[k + 1] < x) k++
    while (k > 0 && xs[k] > x) k--
    const hh = h[k]
    const A = (xs[k + 1] - x) / hh
    const B = 1 - A
    return A * ys[k] + B * ys[k + 1] + ((A * A * A - A) * m[k] + (B * B * B - B) * m[k + 1]) * (hh * hh) / 6
  }
}

function median(arr) {
  if (!arr.length) return NaN
  const s = arr.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Скользящее среднее по равномерной сетке (окно в точках, по центру)
function movingAverage(x, win) {
  const half = Math.floor(win / 2)
  const out = new Array(x.length)
  let sum = 0
  let lo = 0
  let hi = -1
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(x.length - 1, i + half)
    while (hi < b) sum += x[++hi]
    while (lo < a) sum -= x[lo++]
    out[i] = sum / (hi - lo + 1)
  }
  return out
}

/**
 * 1. Отметить годные кадры: палец на месте и нет одиночных скачков.
 * @param {number[][]} frames — [время мс, красный, зелёный]
 * @returns {boolean[]}
 */
export function goodFrames(frames, cfg = OFFLINE) {
  const t0 = frames[0][0]
  return frames.map((f, i) => {
    const [t, r, g] = f
    if (t - t0 < cfg.SKIP_START_MS) return false
    if (r < cfg.FINGER_MIN_RED || r < cfg.FINGER_RED_TO_GREEN * g) return false
    const nb = []
    for (let k = Math.max(0, i - 3); k <= Math.min(frames.length - 1, i + 3); k++) if (k !== i) nb.push(k)
    const gMed = median(nb.map((k) => frames[k][2]))
    const rMed = median(nb.map((k) => frames[k][1]))
    if (Math.abs(g - gMed) > cfg.GLITCH_GREEN_JUMP && Math.abs(r - rMed) > cfg.GLITCH_RED_JUMP / 2) return false
    if (Math.abs(r - rMed) > cfg.GLITCH_RED_JUMP && Math.abs(frames[Math.max(0, i - 1)][1] - frames[Math.min(frames.length - 1, i + 1)][1]) < cfg.GLITCH_RED_JUMP / 2) return false
    return true
  })
}

/**
 * 2–3. Перевести годные кадры на равномерную сетку и отфильтровать.
 * Возвращает перевёрнутый сигнал (пик = удар) и отметку «есть данные» для каждой точки.
 */
export function filteredSignal(frames, good, cfg = OFFLINE) {
  const pts = frames.filter((_, i) => good[i])
  if (pts.length < 10) return { t0: 0, step: cfg.STEP_MS, y: [], valid: [] }
  const t0 = pts[0][0]
  const tEnd = pts[pts.length - 1][0]
  const n = Math.floor((tEnd - t0) / cfg.STEP_MS) + 1
  const x = new Array(n)
  const valid = new Array(n)
  // Участки без разрывов: сплайн строится по каждому отдельно
  const segs = []
  let from = 0
  for (let i = 1; i <= pts.length; i++) {
    if (i === pts.length || pts[i][0] - pts[i - 1][0] >= cfg.GAP_MS) {
      segs.push([from, i - 1])
      from = i
    }
  }
  let si = 0
  let spline = null
  let j = 0
  for (let i = 0; i < n; i++) {
    const t = t0 + i * cfg.STEP_MS
    while (si < segs.length - 1 && pts[segs[si][1]][0] < t) {
      si++
      spline = null
    }
    const [a, b] = segs[si]
    if (t < pts[a][0] || t > pts[b][0] || b - a < 3) {
      // Внутри разрыва: держим ближайшее значение, точку помечаем как «нет данных»
      const near = t < pts[a][0] ? a : b
      x[i] = pts[near][1]
      valid[i] = false
      continue
    }
    valid[i] = true
    if (cfg.SPLINE) {
      if (!spline) {
        const seg = pts.slice(a, b + 1)
        spline = naturalSpline(seg.map((p) => p[0]), seg.map((p) => p[1]))
      }
      x[i] = spline(t)
    } else {
      if (j < a) j = a
      while (j < b - 1 && pts[j + 1][0] < t) j++
      const [ta, ra] = pts[j]
      const [tb, rb] = pts[j + 1]
      const w = tb > ta ? (t - ta) / (tb - ta) : 0
      x[i] = ra + (rb - ra) * Math.min(1, Math.max(0, w))
    }
  }
  const trend = movingAverage(x, Math.round(cfg.HIGHPASS_MS / cfg.STEP_MS))
  const lp = Math.round(cfg.LOWPASS_MS / cfg.STEP_MS)
  const y = movingAverage(movingAverage(x.map((v, i) => -(v - trend[i])), lp), lp)
  return { t0, step: cfg.STEP_MS, y, valid }
}

/**
 * 4. Найти удары: точки самого крутого подъёма волны.
 * @returns {number[]} времена ударов (мс)
 */
export function findBeats(sig, cfg = OFFLINE) {
  const { t0, step, y, valid } = sig
  const d = y.map((v, i) => (i ? (v - y[i - 1]) / step : 0))
  // Кандидаты — локальные максимумы скорости роста
  const cand = []
  for (let i = 2; i < d.length - 2; i++) {
    if (d[i] > 0 && d[i] >= d[i - 1] && d[i] > d[i + 1] && d[i] >= d[i - 2] && d[i] > d[i + 2] && valid[i]) cand.push(i)
  }
  // Порог по силе: доля от типичного (75-й процентиль) в окне вокруг
  const half = Math.round(cfg.PEAK_WINDOW_MS / 2 / step)
  const strong = cand.filter((i) => {
    const near = cand.filter((k) => Math.abs(k - i) <= half).map((k) => d[k]).sort((a, b) => a - b)
    const p75 = near[Math.floor(near.length * 0.75)]
    return d[i] >= cfg.PEAK_SHARE * p75
  })
  // Не ближе MIN_RR_MS: из близких оставляем более крутой
  const minGap = Math.round(cfg.MIN_RR_MS / step)
  const beats = []
  for (const i of strong) {
    const last = beats[beats.length - 1]
    if (last !== undefined && i - last < minGap) {
      if (d[i] > d[last]) beats[beats.length - 1] = i
    } else beats.push(i)
  }
  // Второй проход: ложные удары от второй (дикротической) волны. Если два удара ближе
  // REFRACTORY_SHARE типичного интервала, оставляем более крутой подъём
  const typical = (k) => {
    const lo = Math.max(1, k - cfg.TYPICAL_RR_BEATS)
    const hi = Math.min(beats.length - 1, k + cfg.TYPICAL_RR_BEATS)
    const rr = []
    for (let j = lo; j <= hi; j++) rr.push(beats[j] - beats[j - 1])
    return median(rr)
  }
  let changed = true
  while (changed) {
    changed = false
    for (let k = 1; k < beats.length; k++) {
      if (beats[k] - beats[k - 1] < cfg.REFRACTORY_SHARE * typical(k)) {
        beats.splice(d[beats[k]] > d[beats[k - 1]] ? k - 1 : k, 1)
        changed = true
        break
      }
    }
  }

  // Уточнение вершины скорости параболой
  return beats.map((i) => {
    const a = d[i - 1]
    const b = d[i]
    const c = d[i + 1]
    const den = a - 2 * b + c
    const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0
    return t0 + (i - 0.5 + off) * step // скорость между точками i-1 и i
  })
}

/**
 * 4а. Уточнить удары сопоставлением с усреднённой формой волны (шаблоном).
 * Используется весь подъём волны, а не одна точка — так случайный шум меньше сдвигает удар.
 * @param {{t0:number, step:number, y:number[], valid:boolean[]}} sig
 * @param {number[]} beats — приблизительные времена ударов, мс
 * @returns {number[]} уточнённые времена
 */
export function refineBeats(sig, beats, cfg = OFFLINE) {
  const { t0, step, y, valid } = sig
  const from = Math.round(cfg.TEMPLATE_FROM_MS / step)
  const to = Math.round(cfg.TEMPLATE_TO_MS / step)
  const maxShift = Math.round(cfg.TEMPLATE_MAX_SHIFT_MS / step)
  const len = to - from + 1
  const okAt = (c) => c + from - maxShift - 1 >= 0 && c + to + maxShift + 1 < y.length
  // Отрезок волны вокруг точки c, приведённый к нулевому среднему и единичному разбросу
  const segment = (c) => {
    const s = new Float64Array(len)
    let mean = 0
    for (let k = 0; k < len; k++) {
      s[k] = y[c + from + k]
      mean += s[k]
    }
    mean /= len
    let sd = 0
    for (let k = 0; k < len; k++) {
      s[k] -= mean
      sd += s[k] * s[k]
    }
    sd = Math.sqrt(sd / len) || 1
    for (let k = 0; k < len; k++) s[k] /= sd
    return s
  }
  const cleanAt = (c) => {
    for (let k = c + from - maxShift; k <= c + to + maxShift; k++) if (!valid[k]) return false
    return true
  }
  let times = beats.slice()
  for (let pass = 0; pass < cfg.TEMPLATE_PASSES; pass++) {
    // Шаблон — среднее по чистым ударам (с линейной интерполяцией по дробному положению)
    const tpl = new Float64Array(len)
    let cnt = 0
    for (const b of times) {
      const c = Math.round((b - t0) / step)
      if (!okAt(c) || !cleanAt(c)) continue
      const s = segment(c)
      for (let k = 0; k < len; k++) tpl[k] += s[k]
      cnt++
    }
    if (cnt < 10) return times
    let tm = 0
    for (let k = 0; k < len; k++) tm += tpl[k] / cnt
    let tsd = 0
    for (let k = 0; k < len; k++) {
      tpl[k] = tpl[k] / cnt - tm / len
      tsd += tpl[k] * tpl[k]
    }
    tsd = Math.sqrt(tsd / len) || 1
    for (let k = 0; k < len; k++) tpl[k] /= tsd
    // Для каждого удара — сдвиг с наибольшей похожестью, уточнённый параболой
    times = times.map((b) => {
      const c = Math.round((b - t0) / step)
      if (!okAt(c) || !cleanAt(c)) return b
      const corr = []
      for (let sh = -maxShift - 1; sh <= maxShift + 1; sh++) {
        const s = segment(c + sh)
        let r = 0
        for (let k = 0; k < len; k++) r += s[k] * tpl[k]
        corr.push(r / len)
      }
      let best = 1
      for (let i = 1; i < corr.length - 1; i++) if (corr[i] > corr[best]) best = i
      if (corr[best] < cfg.TEMPLATE_MIN_CORR) return b
      const a = corr[best - 1]
      const m = corr[best]
      const z = corr[best + 1]
      const den = a - 2 * m + z
      const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - z)) / den)) : 0
      const sh = best - maxShift - 1 + off
      // Новое время — положение, где волна лучше всего совпала с шаблоном
      return t0 + (c + sh) * step
    })
  }
  return times
}

/**
 * 5. Интервалы и отбраковка. Интервал засчитывается, если он в разумных пределах,
 * не захватывает участок без данных и не скачет относительно соседних больше чем на 20 %.
 * @returns {{rr:number[], kept:boolean[], beats:number[]}}
 */
export function cleanIntervals(beats, sig, cfg = OFFLINE) {
  const rr = beats.slice(1).map((b, i) => b - beats[i])
  const hasGap = (ta, tb) => {
    const a = Math.floor((ta - sig.t0) / sig.step)
    const b = Math.ceil((tb - sig.t0) / sig.step)
    for (let i = Math.max(0, a); i <= Math.min(sig.valid.length - 1, b); i++) if (!sig.valid[i]) return true
    return false
  }
  const k = cfg.LOCAL_MEDIAN_BEATS
  const kept = rr.map((v, i) => {
    if (v < cfg.MIN_RR_MS || v > cfg.MAX_RR_MS) return false
    if (hasGap(beats[i], beats[i + 1])) return false
    const nb = []
    for (let j = Math.max(0, i - k); j <= Math.min(rr.length - 1, i + k); j++) if (j !== i) nb.push(rr[j])
    const m = median(nb)
    return Math.abs(v - m) <= cfg.MAX_JUMP_SHARE * m
  })
  return { rr, kept, beats }
}

/**
 * Сила пульсовой волны относительно шума яркости кадров.
 * Чем она больше, тем точнее моменты ударов: ошибка ≈ шум / крутизна подъёма.
 * @returns {{amplitude:number, frameNoise:number, snr:number}}
 */
export function signalQuality(frames, good, sig, beats) {
  const { t0, step, y } = sig
  const amps = []
  for (const b of beats) {
    const c = Math.round((b - t0) / step)
    const lo = c - Math.round(300 / step)
    const hi = c + Math.round(400 / step)
    if (lo < 0 || hi >= y.length) continue
    let mn = Infinity
    let mx = -Infinity
    for (let k = lo; k <= hi; k++) {
      if (y[k] < mn) mn = y[k]
      if (y[k] > mx) mx = y[k]
    }
    amps.push(mx - mn)
  }
  const g = frames.filter((_, i) => good[i]).map((f) => f[1])
  let s = 0
  let n = 0
  for (let i = 1; i < g.length - 1; i++) {
    const r = g[i] - (g[i - 1] + g[i + 1]) / 2
    s += r * r
    n++
  }
  const frameNoise = n ? Math.sqrt(s / n / 1.5) : NaN
  const amplitude = median(amps)
  return { amplitude, frameNoise, snr: amplitude / frameNoise }
}

/**
 * Весь разбор записи.
 * @param {number[][]} frames
 */
export function analyzeRecording(frames, cfg = OFFLINE) {
  const good = goodFrames(frames, cfg)
  const sig = filteredSignal(frames, good, cfg)
  const rough = findBeats(sig, cfg)
  const beats = cfg.TEMPLATE ? refineBeats(sig, rough, cfg) : rough
  const res = cleanIntervals(beats, sig, cfg)
  return { ...res, goodShare: good.filter(Boolean).length / frames.length, quality: signalQuality(frames, good, sig, beats), sig }
}
