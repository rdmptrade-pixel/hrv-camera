// Итог замера: разбор записи + индекс Баевского + оценка качества. Без обращений к браузеру.
import { analyzeRecording } from './offline.js'
import { baevsky } from './baevsky.js'
import { bandShares } from './spectrum.js'
import { pnn50, adaptationRisk } from './risk.js'

export const QUALITY = {
  GOOD: { minIntervals: 250, minAccepted: 0.9, minGoodFrames: 0.95, label: 'хорошее' },
  FAIR: { minIntervals: 150, minAccepted: 0.8, minGoodFrames: 0.85, label: 'среднее' },
  BAD_LABEL: 'плохое — повторите замер',
}

/**
 * Оценка качества замера.
 * @returns {'good'|'fair'|'bad'}
 */
export function qualityLevel(n, acceptedShare, goodFrameShare, q = QUALITY) {
  const ok = (lvl) => n >= lvl.minIntervals && acceptedShare >= lvl.minAccepted && goodFrameShare >= lvl.minGoodFrames
  if (ok(q.GOOD)) return 'good'
  if (ok(q.FAIR)) return 'fair'
  return 'bad'
}

export function qualityLabel(level, q = QUALITY) {
  return level === 'good' ? q.GOOD.label : level === 'fair' ? q.FAIR.label : q.BAD_LABEL
}

/**
 * Из сырых кадров — запись для истории.
 * @param {number[][]} frames — [время мс, красный, зелёный]
 * @param {Date} date
 */
export function buildResult(frames, date = new Date()) {
  const res = analyzeRecording(frames)
  return { date: date.toISOString(), ...computeFromIntervals(res.rr, res.kept), beats: res.beats.length, goodFrames: Math.round(res.goodShare * 100), quality: qualityLevel(res.kept.filter(Boolean).length, res.rr.length ? res.kept.filter(Boolean).length / res.rr.length : 0, res.goodShare) }
}

/**
 * Все показатели по интервалам. Отдельно от кадров — чтобы пересчитывать сохранённые замеры.
 * @param {number[]} rr — все интервалы подряд, мс
 * @param {boolean[]} kept — принят ли интервал после отбраковки
 */
export function computeFromIntervals(rr, kept) {
  const nn = rr.filter((_, i) => kept[i])
  const b = baevsky(nn)
  // Моменты окончания принятых интервалов (от начала записи), с — для спектра
  const t = []
  let acc = 0
  rr.forEach((v, i) => {
    acc += v
    if (kept[i]) t.push(acc / 1000)
  })
  const spec = bandShares(t, nn)
  const p50 = pnn50(rr, kept)
  const cv = b.meanRr ? (b.sdnn / b.meanRr) * 100 : NaN
  const risk = adaptationRisk({ hr: b.hr, si: b.si, pnn50: p50, hfPct: spec.hfPct, rmssd: b.rmssd, sdnn: b.sdnn, cv })
  const round = (v, d = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
  return {
    si: round(b.si),
    zone: b.zone || '—',
    zoneKey: b.zoneKey || null,
    color: b.color || '#777',
    hr: round(b.hr, 1),
    mo: round(b.mo, 3),
    amo: round(b.amo, 1),
    mxdmn: round(b.mxdmn, 3),
    sdnn: round(b.sdnn),
    rmssd: round(b.rmssd),
    pnn50: round(p50, 1),
    cv: round(cv, 1),
    vlfPct: round(spec.vlfPct),
    lfPct: round(spec.lfPct),
    hfPct: round(spec.hfPct),
    risk: risk
      ? {
          category: risk.category,
          fr: round(risk.fr, 2),
          sn: round(risk.sn, 2),
          type: risk.type.label,
          typeKey: risk.type.key,
          typeProb: round(Math.max(...risk.type.probs) * 100),
          four: risk.four.map((v) => round(v * 100)),
          topState: risk.topState,
        }
      : null,
    intervals: nn.length,
    accepted: round(rr.length ? (nn.length / rr.length) * 100 : 0),
    histogram: b.histogram || [],
    // Сами интервалы (мс, целые) и отметки «принят» — для пересчёта при уточнении формул
    rr: rr.map((v) => Math.round(v)),
    kept: kept.map((k) => (k ? 1 : 0)).join(''),
  }
}
