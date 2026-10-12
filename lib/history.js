// История замеров — только в браузере телефона (localStorage) и выгрузка в CSV.
import { qualityLabel } from './result.js'
import { BAEVSKY } from './baevsky.js'

// Оценка по текущей шкале (у старых замеров могла быть сохранена прежняя формулировка)
const zoneLabel = (si) => (si === null || si === undefined ? '—' : BAEVSKY.ZONES.find((z) => si <= z.max).label)

const KEY = 'hrv-camera.history.v1'

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
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
  const head = ['Дата', 'Время', 'ИН Баевского', 'Оценка', 'Качество', 'Пульс', 'Mo, с', 'AMo, %', 'MxDMn, с', 'SDNN, мс', 'RMSSD, мс', 'Интервалов', 'Принято, %']
  const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','))
  const rows = list.map((r) => {
    const d = new Date(r.date)
    const date = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
    const time = d.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
    return [date, time, num(r.si), zoneLabel(r.si), qualityLabel(r.quality), num(r.hr), num(r.mo), num(r.amo), num(r.mxdmn), num(r.sdnn), num(r.rmssd), num(r.intervals), num(r.accepted)].join(';')
  })
  return '﻿' + [head.join(';'), ...rows].join('\r\n')
}
