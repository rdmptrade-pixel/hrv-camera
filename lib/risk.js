// Модель адаптационного риска Баевского — непрерывная замена ПАРС. Без обращений к браузеру.
//
// Источники:
//  [К] монография по космической кардиологии, гл. 3.2 (Баевский Р.М., Черникова А.Г.), с. 105–116:
//      «лестница состояний» и светофор (с. 106–107), формулы ФР и СН (с. 114),
//      категории риска 1–10 по вероятностям состояний (рис. 3.12, с. 115);
//  [П] патент RU 2448644 (Баевский Р.М. и др., 2010): тип вегетативной регуляции,
//      поправки ФР и СН на тип, вероятности пяти состояний.
// ФР и СН в [П] записаны в стандартизованном виде (те же коэффициенты — в [К], с. 113),
// в [К] на с. 114 — в обычных единицах. Это одна и та же модель: отношения коэффициентов
// дают одинаковые разбросы показателей (ЧСС ≈ 9, ИН ≈ 110, pNN50 ≈ 9,5, HF% ≈ 14).

export const RISK = {
  // [К] с. 114, обычные единицы: ЧСС уд/мин, ИН усл. ед., pNN50 %, HF %
  FR: { c: 4.087, hr: -0.012, si: -0.009, pnn50: -0.005, hf: -0.006 },
  SN: { c: -0.697, hr: 0.015, si: -0.001, pnn50: -0.132, hf: 0.043 },

  // [П] тип регуляции: k = c + a·ИН + b·RMSSD + d·SDNN + e·CV, вероятности — softmax
  TYPES: [
    { key: 'I', label: 'ваготонический', c: -109.864, si: 1.116, rmssd: 0.768, sdnn: 1.792, cv: -1.92, fr: -1.057, sn: 2.982 },
    { key: 'II', label: 'нормотонический', c: -92.2249, si: 1.1101, rmssd: 0.7539, sdnn: 1.2209, cv: 1.8501, fr: -0.717, sn: 0.682 },
    { key: 'III', label: 'промежуточный (нормо-симпатотонический)', c: -104.534, si: 1.231, rmssd: 0.665, sdnn: 1.177, cv: 3.267, fr: -0.477, sn: -0.218 },
    { key: 'IV', label: 'симпатотонический', c: -174.249, si: 1.625, rmssd: 1.031, sdnn: 1.429, cv: 2.946, fr: 0.083, sn: -0.618 },
  ],

  // [П] состояния: m = c + a·ФРк + b·СНк, вероятности — softmax
  STATES: [
    { key: 'severe', label: 'тяжёлое патологическое', c: -935.33, fr: -30.818, sn: -3.647 },
    { key: 'path', label: 'патологическое', c: -26.195, fr: -4.9126, sn: 0.0752 },
    { key: 'premorbid', label: 'преморбидное', c: -4.1884, fr: -1.429, sn: 0.718 },
    { key: 'donoz', label: 'донозологическое', c: -1.4238, fr: 0.0319, sn: 0.7384 },
    { key: 'norm', label: 'норма', c: -1.7069, fr: 0.9762, sn: -0.3592 },
  ],

  // [К] рис. 3.12: профили вероятностей для категорий 1–10, % — [норма, донозол., преморбид., срыв адаптации].
  // Правило «ближайший профиль» — прочтение рисунка приложением: в [К] и [П] точного правила нет
  PROFILES: [
    [80, 20, 0, 0], [40, 60, 0, 0], [20, 80, 0, 0], [0, 80, 20, 0], [0, 60, 40, 0],
    [0, 40, 50, 10], [0, 20, 60, 20], [0, 0, 80, 20], [0, 0, 60, 40], [0, 0, 40, 60],
  ],

  // [К] с. 106–107: светофор
  ZONES: [
    { max: 3, color: '#43a047', label: 'физиологическая норма', advice: 'всё в порядке' },
    { max: 5, color: '#fdd835', label: 'донозологическое состояние', advice: 'нужны оздоровительные и профилактические меры' },
    { max: 7, color: '#fdd835', label: 'преморбидное состояние', advice: 'нужны оздоровительные и профилактические меры' },
    { max: 10, color: '#e53935', label: 'срыв адаптации', advice: 'нужны обследование у врача и лечение' },
  ],
}

function softmax(v) {
  const m = Math.max(...v)
  const e = v.map((x) => Math.exp(x - m))
  const s = e.reduce((a, x) => a + x, 0)
  return e.map((x) => x / s)
}

/**
 * pNN50 — доля пар соседних принятых интервалов, отличающихся больше чем на 50 мс, %.
 * @param {number[]} rr — все интервалы подряд
 * @param {boolean[]} kept — принят ли интервал
 */
export function pnn50(rr, kept) {
  let pairs = 0
  let over = 0
  for (let i = 1; i < rr.length; i++) {
    if (!kept[i] || !kept[i - 1]) continue
    pairs++
    if (Math.abs(rr[i] - rr[i - 1]) > 50) over++
  }
  return pairs ? (over / pairs) * 100 : NaN
}

/**
 * Тип вегетативной регуляции [П].
 * @returns {{key:string, label:string, probs:number[]}}
 */
export function regulationType({ si, rmssd, sdnn, cv }, cfg = RISK) {
  const k = cfg.TYPES.map((t) => t.c + t.si * si + t.rmssd * rmssd + t.sdnn * sdnn + t.cv * cv)
  const probs = softmax(k)
  const i = probs.indexOf(Math.max(...probs))
  return { key: cfg.TYPES[i].key, label: cfg.TYPES[i].label, index: i, probs }
}

/**
 * Полная оценка адаптационного риска.
 * @param {{hr:number, si:number, pnn50:number, hfPct:number, rmssd:number, sdnn:number, cv:number}} x
 */
export function adaptationRisk(x, cfg = RISK) {
  const vals = [x.hr, x.si, x.pnn50, x.hfPct, x.rmssd, x.sdnn, x.cv]
  if (!vals.every(Number.isFinite)) return null
  const lin = (c) => c.c + c.hr * x.hr + c.si * x.si + c.pnn50 * x.pnn50 + c.hf * x.hfPct
  const fr = lin(cfg.FR)
  const sn = lin(cfg.SN)
  const type = regulationType(x, cfg)
  const t = cfg.TYPES[type.index]
  const frk = fr + t.fr
  const snk = sn + t.sn
  const stateProbs = softmax(cfg.STATES.map((s) => s.c + s.fr * frk + s.sn * snk))
  const p = Object.fromEntries(cfg.STATES.map((s, i) => [s.key, stateProbs[i]]))
  // Четыре группы рисунка 3.12: срыв адаптации = патологическое + тяжёлое патологическое
  const four = [p.norm, p.donoz, p.premorbid, p.path + p.severe]
  const dist = cfg.PROFILES.map((pr) => pr.reduce((a, v, i) => a + (v / 100 - four[i]) ** 2, 0))
  const category = dist.indexOf(Math.min(...dist)) + 1
  const zone = cfg.ZONES.find((z) => category <= z.max)
  const top = cfg.STATES[stateProbs.indexOf(Math.max(...stateProbs))]
  return { fr, sn, type, states: p, four, category, zone, topState: top.label }
}
