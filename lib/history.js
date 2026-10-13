// История замеров — только в браузере телефона (localStorage) и выгрузка в CSV.
import { qualityLabel, upgradeResult, MODEL_VERSION } from './result.js'
import { BAEVSKY } from './baevsky.js'

// Оценка по текущей шкале (у старых замеров могла быть сохранена прежняя формулировка)
const zoneLabel = (si) => (si === null || si === undefined ? '—' : BAEVSKY.ZONES.find((z) => si <= z.max).label)

const KEY = 'hrv-camera.history.v1'

export function loadHistory() {
  let list = []
  try {
    const raw = localStorage.getItem(KEY)
    list = raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
  // Замеры с сохранёнными интервалами пересчитываем по текущей версии расчёта
  if (list.some((r) => r && Array.isArray(r.rr) && !(r.modelVersion >= MODEL_VERSION))) {
    list = list.map(upgradeResult)
    try {
      localStorage.setItem(KEY, JSON.stringify(list))
    } catch (e) {
      // не сохранилось — пересчитаем в следующий раз
    }
  }
  return list
}

export function saveToHistory(result) {
  const list = loadHistory()
  list.push(result)
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch (e) {
    return false
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY)
  } catch (e) {
    // нечего делать
  }
}

/**
 * CSV для Excel: разделитель «;», дробная часть через запятую, дата по Москве.
 * @param {object[]} list
 * @returns {string}
 */
export function toCsv(list) {
  const head = ['Дата', 'Время', 'Категория риска 1–10', 'Состояние (наиболее вероятное)', 'Норма, %', 'Донозологическое, %', 'Преморбидное, %', 'Срыв адаптации, %', 'ФР', 'СН',
    'ИН Баевского', 'Оценка ИН', 'Качество', 'Шум камеры, мс', 'Сила пульса к шуму', 'Пульс', 'Mo, с', 'AMo, %', 'MxDMn, с', 'SDNN, мс', 'RMSSD, мс', 'pNN50, %', 'CV, %', 'VLF, %', 'LF, %', 'HF, %',
    'SDNN по камере, мс', 'RMSSD по камере, мс', 'pNN50 по камере, %', 'HF по камере, %', 'Интервалов', 'Принято, %']
  const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','))
  const rows = list.map((r) => {
    const d = new Date(r.date)
    const date = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
    const time = d.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
    const k = r.risk || { four: [] }
    const w = r.raw || {}
    return [date, time, num(k.category), k.topState || '', num(k.four[0]), num(k.four[1]), num(k.four[2]), num(k.four[3]), num(k.fr), num(k.sn),
      num(r.si), zoneLabel(r.si), qualityLabel(r.quality), num(r.noise), num(r.snr), num(r.hr), num(r.mo), num(r.amo), num(r.mxdmn), num(r.sdnn), num(r.rmssd), num(r.pnn50), num(r.cv), num(r.vlfPct), num(r.lfPct), num(r.hfPct),
      num(w.sdnn), num(w.rmssd), num(w.pnn50), num(w.hfPct), num(r.intervals), num(r.accepted)].join(';')
  })
  return '﻿' + [head.join(';'), ...rows].join('\r\n')
}
