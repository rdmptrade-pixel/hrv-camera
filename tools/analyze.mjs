// Разбор файла записи с телефона: node tools/analyze.mjs путь/к/pulse-*.json
import { readFileSync } from 'node:fs'
import { analyzeRecording } from '../lib/offline.js'
import { baevsky } from '../lib/baevsky.js'

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const frames = data.frames
const res = analyzeRecording(frames)
const nn = res.rr.filter((_, i) => res.kept[i])
const b = baevsky(nn)
const dur = (frames[frames.length - 1][0] - frames[0][0]) / 1000

console.log(`Запись: ${data.recordedAt}, ${dur.toFixed(0)} с, кадров ${frames.length}`)
console.log(`Годных кадров: ${(res.goodShare * 100).toFixed(1)} %`)
console.log(`Найдено ударов: ${res.beats.length}, интервалов ${res.rr.length}, принято ${nn.length} (${((nn.length / res.rr.length) * 100).toFixed(0)} %)`)
console.log(`Пульс: ${b.hr.toFixed(1)}, средний интервал ${b.meanRr.toFixed(0)} мс`)
console.log(`SDNN ${b.sdnn.toFixed(0)} мс, RMSSD ${b.rmssd.toFixed(0)} мс`)
console.log(`Баевский: Mo ${b.mo.toFixed(3)} с, AMo ${b.amo.toFixed(1)} %, MxDMn ${b.mxdmn.toFixed(3)} с, ИН ${b.si.toFixed(0)} — ${b.zone}${b.reliable ? '' : ' (МАЛО ИНТЕРВАЛОВ)'}`)
console.log('Гистограмма (столбец мс: число):', b.histogram.map(([k, v]) => `${k}:${v}`).join(' '))
const rej = res.rr.map((v, i) => [v, res.kept[i]]).filter(([, k]) => !k).map(([v]) => Math.round(v))
console.log('Отбракованные интервалы:', rej.join(' '))
if (process.argv.includes('--rr')) console.log('Интервалы:', res.rr.map((v, i) => Math.round(v) + (res.kept[i] ? '' : '×')).join(' '))
