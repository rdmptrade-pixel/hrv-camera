// Проверка разбора записи и формулы Баевского.
// Запуск: node tools/test-offline.mjs

import assert from 'node:assert/strict'
import { analyzeRecording } from '../lib/offline.js'
import { baevsky } from '../lib/baevsky.js'
import { buildResult, qualityLevel } from '../lib/result.js'
import { toCsv } from '../lib/history.js'

let seed = 11
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const noise = (amp) => (rnd() * 2 - 1) * amp

// 1. Формула Баевского на известном примере:
// 50 интервалов по 800 мс, 30 по 850, 20 по 900 → Mo = 0,825 с, AMo = 50 %, MxDMn = 0,1 с, ИН = 50 / (2·0,825·0,1) ≈ 303
const nn = [...Array(50).fill(810), ...Array(30).fill(860), ...Array(20).fill(910)]
const b = baevsky(nn)
assert.equal(b.mo, 0.825)
assert.equal(b.amo, 50)
assert.equal(Math.round(b.mxdmn * 1000), 100)
assert.equal(Math.round(b.si), 303)
assert.equal(b.zone, 'выраженное напряжение')
assert.equal(baevsky([...Array(40).fill(760), ...Array(30).fill(810), ...Array(30).fill(710), 650, 910]).zoneKey, 'norm') // ИН ≈ 97
console.log('— формула Баевского: ИН', Math.round(b.si), '(ожидалось 303) ✓')

// 2. Искусственная запись как с телефона: 5 мин, ~29 кадров/с, основная волна + вторая (дикротическая),
// дрейф, шум, один сбойный кадр в минуту, палец ставится в первые полсекунды
function simulate({ baseRr = 760, seconds = 300, fps = 29.3 }) {
  const beats = []
  let t = 300
  let i = 0
  while (t < seconds * 1000) {
    beats.push(t)
    t += baseRr + 35 * Math.sin(i / 4) + noise(12)
    i++
  }
  const frames = []
  for (let f = 0; f * (1000 / fps) < seconds * 1000; f++) {
    const ft = f * (1000 / fps) + noise(5)
    let pulse = 0
    for (const bt of beats) {
      const d = ft - bt
      if (d < 0 || d > 900) continue
      const main = d < 150 ? (1 - Math.cos((Math.PI * d) / 150)) / 2 : Math.exp(-(d - 150) / 220)
      // вторая волна через ~330 мс — с собственным, более пологим подъёмом
      const dd = d - 330
      const second = dd > 0 && dd < 400 ? 0.35 * Math.sin((Math.PI * dd) / 400) : 0
      pulse += main + second
    }
    let r = 175 + 3 * Math.sin(ft / 9000) - 0.8 * pulse + noise(0.08)
    let g = 1.5
    if (ft < 500) r = 60 // палец ещё не на камере
    if (f % 1750 === 900) {
      r -= 2 // сбойный кадр: блик
      g += 0.5
    }
    frames.push([ft, r, g])
  }
  return { beats, frames }
}

const { beats, frames } = simulate({})
const res = analyzeRecording(frames)
const kept = res.rr.filter((_, i) => res.kept[i])
const share = kept.length / res.rr.length
// Сверка с настоящими интервалами по ближайшим ударам
const nearest = (x) => beats.reduce((a, c) => (Math.abs(c - x + 60) < Math.abs(a - x + 60) ? c : a), beats[0])
const errs = []
res.rr.forEach((v, i) => {
  if (!res.kept[i]) return
  errs.push(Math.abs(v - (nearest(res.beats[i + 1]) - nearest(res.beats[i]))))
})
const meanErr = errs.reduce((a, v) => a + v, 0) / errs.length
console.log(`— запись со второй волной: ударов ${beats.length}, найдено ${res.beats.length}, принято ${(share * 100).toFixed(0)} %, ошибка интервала ср ${meanErr.toFixed(1)} мс`)
assert.ok(Math.abs(res.beats.length - beats.length) <= 6, 'число ударов близко к настоящему')
assert.ok(share >= 0.93, 'принято не меньше 93 % интервалов')
assert.ok(meanErr <= 10, 'средняя ошибка интервала не больше 10 мс')

// 3. Итог замера и качество
const r = buildResult(frames, new Date('2026-10-12T08:00:00Z'))
console.log(`— итог: ИН ${r.si}, ${r.zone}, пульс ${r.hr}, качество ${r.quality}`)
assert.equal(r.quality, 'good')
assert.ok(r.hr > 75 && r.hr < 82)
assert.equal(qualityLevel(100, 0.95, 0.99), 'bad') // мало интервалов
assert.equal(qualityLevel(200, 0.85, 0.9), 'fair')

// 4. CSV: дата по Москве, запятая в дробях, качество словами
const csv = toCsv([r])
assert.ok(csv.includes('12.10.2026;11:00;'), 'дата и время по Москве')
assert.ok(csv.includes(';хорошее;'), 'качество словами')
console.log('— CSV ✓')

console.log('Все проверки пройдены')
