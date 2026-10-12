// Итог замера: разбор записи + индекс Баевского + оценка качества. Без обращений к браузеру.
import { analyzeRecording } from './offline.js'
import { baevsky } from './baevsky.js'

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
  const nn = res.rr.filter((_, i) => res.kept[i])
  const b = baevsky(nn)
  const acceptedShare = res.rr.length ? nn.length / res.rr.length : 0
  const quality = qualityLevel(nn.length, acceptedShare, res.goodShare)
  const round = (v, d = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
  return {
    date: date.toISOString(),
    si: round(b.si),
    zone: b.zone || '—',
    hr: round(b.hr, 1),
    mo: round(b.mo, 3),
    amo: round(b.amo, 1),
    mxdmn: round(b.mxdmn, 3),
    sdnn: round(b.sdnn),
    rmssd: round(b.rmssd),
    intervals: nn.length,
    beats: res.beats.length,
    accepted: round(acceptedShare * 100),
    goodFrames: round(res.goodShare * 100),
    quality,
    histogram: b.histogram || [],
  }
}
