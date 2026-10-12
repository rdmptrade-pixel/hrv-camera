// Поиск ударов сердца в сигнале камеры (палец на объективе со вспышкой).
// Чистые функции и класс без обращений к браузеру — проверяются на сервере: node tools/test-signal.mjs

export const SIGNAL = {
  BASELINE_MS: 1500, // окно для вычитания медленного дрейфа яркости
  SMOOTH_SAMPLES: 3, // сглаживание по соседним кадрам
  AMPLITUDE_WINDOW_MS: 2000, // окно для оценки размаха пульсовой волны
  THRESHOLD_SHARE: 0.4, // пик засчитывается, если выше этой доли размаха
  REFRACTORY_MS: 333, // ближе удары не бывают (180 уд/мин)
  KEEP_MS: 4000, // сколько последних кадров держать в памяти
}

/**
 * Находит удары по мере поступления кадров.
 * На вход — время кадра (мс) и средняя яркость красного канала.
 * Удар сердца затемняет палец, поэтому сигнал переворачиваем: пик = удар.
 */
export class BeatDetector {
  constructor(cfg = SIGNAL) {
    this.cfg = cfg
    this.t = [] // время кадров
    this.x = [] // исходная яркость
    this.y = [] // перевёрнутый сигнал без дрейфа, сглаженный
    this.lastBeat = -Infinity
  }

  /**
   * Добавить кадр. Возвращает время удара (мс, уточнённое между кадрами) или null.
   * @param {number} t
   * @param {number} value
   * @returns {number|null}
   */
  push(t, value) {
    const c = this.cfg
    this.t.push(t)
    this.x.push(value)

    // Базовая линия — среднее за последние BASELINE_MS
    let sum = 0
    let n = 0
    for (let i = this.x.length - 1; i >= 0 && t - this.t[i] <= c.BASELINE_MS; i--) {
      sum += this.x[i]
      n++
    }
    const raw = -(value - sum / n)

    // Сглаживание: среднее с предыдущими «сырыми» точками
    this._raw = this._raw || []
    this._raw.push(raw)
    const k = Math.min(c.SMOOTH_SAMPLES, this._raw.length)
    let s = 0
    for (let i = this._raw.length - k; i < this._raw.length; i++) s += this._raw[i]
    this.y.push(s / k)

    this._trim(t)
    return this._detect()
  }

  // Последние значения обработанного сигнала — для рисования волны
  wave() {
    return { t: this.t.slice(), y: this.y.slice() }
  }

  _trim(t) {
    while (this.t.length && t - this.t[0] > this.cfg.KEEP_MS) {
      this.t.shift()
      this.x.shift()
      this.y.shift()
      this._raw.shift()
    }
  }

  // Удар — точка самого крутого подъёма волны (максимум скорости роста):
  // она резче вершины и меньше зависит от формы волны
  _detect() {
    const c = this.cfg
    const n = this.y.length
    if (n < 4) return null
    const d = (i) => (this.y[i] - this.y[i - 1]) / Math.max(1, this.t[i] - this.t[i - 1])
    const d0 = d(n - 3)
    const d1 = d(n - 2)
    const d2 = d(n - 1)
    if (!(d1 > d0 && d1 >= d2) || d1 <= 0) return null

    // Порог — доля наибольшей скорости роста за последние AMPLITUDE_WINDOW_MS
    const tNow = this.t[n - 1]
    let max = 0
    for (let i = n - 1; i >= 1 && tNow - this.t[i] <= c.AMPLITUDE_WINDOW_MS; i--) {
      const v = d(i)
      if (v > max) max = v
    }
    if (d1 < c.THRESHOLD_SHARE * max) return null

    // Уточнение параболой по трём точкам скорости (кадры идут шагом ~33 мс).
    // Скорость d(i) относится к середине между кадрами i-1 и i
    const mid = (i) => (this.t[i] + this.t[i - 1]) / 2
    const step = (mid(n - 1) - mid(n - 3)) / 2
    const denom = d0 - 2 * d1 + d2
    const offset = denom !== 0 ? (0.5 * (d0 - d2)) / denom : 0
    const beat = mid(n - 2) + Math.max(-0.5, Math.min(0.5, offset)) * step

    if (beat - this.lastBeat < c.REFRACTORY_MS) return null
    this.lastBeat = beat
    return beat
  }
}

/**
 * Медиана массива чисел.
 * @param {number[]} arr
 * @returns {number}
 */
export function median(arr) {
  if (!arr.length) return NaN
  const s = arr.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Среднее и стандартное отклонение.
 * @param {number[]} arr
 * @returns {{mean:number, sd:number}}
 */
export function meanSd(arr) {
  if (!arr.length) return { mean: NaN, sd: NaN }
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const sd = arr.length > 1 ? Math.sqrt(arr.reduce((a, v) => a + (v - mean) ** 2, 0) / (arr.length - 1)) : 0
  return { mean, sd }
}
