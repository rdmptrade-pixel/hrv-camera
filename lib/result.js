// Итог замера: разбор записи + индекс Баевского + оценка качества. Без обращений к браузеру.
import { analyzeRecording } from './offline.js'
import { baevsky } from './baevsky.js'
import { bandShares } from './spectrum.js'
import { pnn50, adaptationRisk } from './risk.js'
import { estimateNoise, correctedTimeDomain, smoothedNN, noiseLevel } from './noise.js'

// Версия расчёта: сохранённые замеры с интервалами пересчитываются, если версия старее
export const MODEL_VERSION = 2

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
  const kept = res.kept.filter(Boolean).length
  const q = res.quality
  return {
    date: date.toISOString(),
    ...computeFromIntervals(res.rr, res.kept),
    beats: res.beats.length,
    goodFrames: Math.round(res.goodShare * 100),
    goodShare: res.goodShare,
    snr: Number.isFinite(q.snr) ? Math.round(q.snr * 10) / 10 : null,
    quality: qualityLevel(kept, res.rr.length ? kept / res.rr.length : 0, res.goodShare),
  }
}

/**
 * Все показатели по интервалам. Отдельно от кадров — чтобы пересчитывать сохранённые замеры.
 * Показатели вариабельности считаются дважды: как получилось по камере (raw) и с поправкой
 * на шум камеры (основные, они же идут в модель риска).
 * @param {number[]} rr — все интервалы подряд, мс
 * @param {boolean[]|string} kept — принят ли интервал после отбраковки (или строка из 0/1)
 */
export function computeFromIntervals(rr, keptIn) {
  const kept = typeof keptIn === 'string' ? [...keptIn].map((c) => c === '1') : keptIn
  const nn = rr.filter((_, i) => kept[i])
  const b = baevsky(nn)
  // Моменты окончания принятых интервалов (от начала записи), с — для спектра
  const t = []
  let acc = 0
  rr.forEach((v, i) => {
    acc += v
    if (kept[i]) t.push(acc / 1000)
  })
  const noise = estimateNoise(rr, kept)
  const sigma = Number.isFinite(noise.sigma) ? noise.sigma : 0
  const raw = { si: b.si, sdnn: b.sdnn, rmssd: b.rmssd, pnn50: pnn50(rr, kept), spec: bandShares(t, nn, 0) }
  const corr = correctedTimeDomain(noise.diffVar ? noise : { sigma: 0, diffVar: b.rmssd ** 2 }, b.sdnn)
  const bs = baevsky(smoothedNN(rr, kept)) // гистограмма и ИН — по сглаженным интервалам
  const spec = bandShares(t, nn, sigma)
  const cv = b.meanRr ? (corr.sdnn / b.meanRr) * 100 : NaN
  const risk = adaptationRisk({ hr: b.hr, si: bs.si, pnn50: corr.pnn50, hfPct: spec.hfPct })
  const round = (v, d = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
  return {
    modelVersion: MODEL_VERSION,
    si: round(bs.si),
    zone: bs.zone || '—',
    zoneKey: bs.zoneKey || null,
    color: bs.color || '#777',
    hr: round(b.hr, 1),
    mo: round(bs.mo, 3),
    amo: round(bs.amo, 1),
    mxdmn: round(bs.mxdmn, 3),
    sdnn: round(corr.sdnn),
    rmssd: round(corr.rmssd),
    pnn50: round(corr.pnn50, 1),
    cv: round(cv, 1),
    vlfPct: round(spec.vlfPct),
    lfPct: round(spec.lfPct),
    hfPct: round(spec.hfPct),
    noise: round(noise.sigma, 1),
    noiseLevel: noiseLevel(noise.sigma),
    // Как получилось по камере без поправки — для сравнения
    raw: {
      si: round(raw.si),
      sdnn: round(raw.sdnn),
      rmssd: round(raw.rmssd),
      pnn50: round(raw.pnn50, 1),
      hfPct: round(raw.spec.hfPct),
    },
    risk: risk
      ? {
          category: risk.category,
          fr: round(risk.fr, 2),
          sn: round(risk.sn, 2),
          four: risk.four.map((v) => round(v * 100)),
          topState: risk.topState,
        }
      : null,
    intervals: nn.length,
    accepted: round(rr.length ? (nn.length / rr.length) * 100 : 0),
    histogram: bs.histogram || [],
    // Сами интервалы (мс, целые) и отметки «принят» — для пересчёта при уточнении формул
    rr: rr.map((v) => Math.round(v)),
    kept: kept.map((k) => (k ? 1 : 0)).join(''),
  }
}

/**
 * Пересчитать сохранённый замер по текущей версии расчёта (если в нём есть интервалы).
 * Качество записи (годные кадры, сила волны) берётся из сохранённого.
 */
export function upgradeResult(r) {
  if (!r || r.modelVersion >= MODEL_VERSION || !Array.isArray(r.rr) || typeof r.kept !== 'string') return r
  const fresh = computeFromIntervals(r.rr, r.kept)
  return { ...r, ...fresh }
}
