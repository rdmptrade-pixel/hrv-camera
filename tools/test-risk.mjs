// Проверка модели адаптационного риска на средних значениях групп из книги (табл. 3.3, с. 112)
// и проверка спектра на сигнале с известной частотой.
// Запуск: node tools/test-risk.mjs

import assert from 'node:assert/strict'
import { adaptationRisk, riskCategory, pnn50 } from '../lib/risk.js'
import { estimateNoise, correctedTimeDomain } from '../lib/noise.js'
import { bandShares } from '../lib/spectrum.js'

const GROUPS = [
  // название, [ЧСС, ИН, pNN50, HF%], ожидаемое состояние, ожидаемая категория
  ['норма', [75.4, 124.0, 12.24, 23.25], 'норма', 1],
  ['донозологические', [82.4, 320.5, 1.88, 18.17], 'донозологическое', 3],
  ['преморбидные', [80.9, 636.7, 0.4, 19.01], 'преморбидное', 7],
  ['патологические', [94.8, 1374.3, 0.57, 13.2], 'патологическое', 10],
]
for (const [name, [hr, si, p, hf], state, cat] of GROUPS) {
  const r = adaptationRisk({ hr, si, pnn50: p, hfPct: hf })
  assert.equal(r.topState, state, name + ': состояние')
  assert.equal(r.category, cat, name + ': категория')
  console.log(`— группа «${name}» → ${state}, категория ${cat} ✓`)
}

// Примеры из патента RU 2586041: 0,78/0,22 → группа 1–2; 0,31/0,67 → группа 3–4
assert.ok([1, 2].includes(riskCategory([0.78, 0.22, 0, 0])))
assert.ok([3, 4].includes(riskCategory([0.31, 0.67, 0.02, 0])))
console.log('— примеры патента RU 2586041 ✓')

// ФР и СН по с. 114 на средних группы нормы: книга, рис. 3.11 — около (1,9; −0,35)
const n = adaptationRisk({ hr: 75.4, si: 124, pnn50: 12.24, hfPct: 23.25 })
assert.ok(Math.abs(n.fr - 1.87) < 0.01 && Math.abs(n.sn + 0.31) < 0.01)
console.log('— ФР и СН нормы совпадают с рис. 3.11 ✓')

// Шум: к ровным «настоящим» интервалам с плавным колебанием добавляем шум времени удара ±15 мс —
// оценка шума и поправленные RMSSD/pNN50 должны вернуться к настоящим
{
  let sd = 3
  const rnd = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648 }
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
  const beatsTrue = [0]
  for (let i = 0; i < 400; i++) beatsTrue.push(beatsTrue[i] + 800 + 25 * Math.sin(i / 7))
  const beatsNoisy = beatsTrue.map((b) => b + 15 * gauss())
  const rrTrue = beatsTrue.slice(1).map((b, i) => b - beatsTrue[i])
  const rr = beatsNoisy.slice(1).map((b, i) => b - beatsNoisy[i])
  const kept = rr.map(() => true)
  const nz = estimateNoise(rr, kept)
  const rmssdTrue = Math.sqrt(rrTrue.slice(1).reduce((a, v, i) => a + (v - rrTrue[i]) ** 2, 0) / (rrTrue.length - 1))
  const c = correctedTimeDomain(nz, 20)
  assert.ok(Math.abs(nz.sigma - 15) < 3, 'шум ' + nz.sigma)
  assert.ok(Math.abs(c.rmssd - rmssdTrue) < 8, 'RMSSD ' + c.rmssd + ' против ' + rmssdTrue)
  console.log(`— шум ±15 мс оценён как ±${nz.sigma.toFixed(1)}; RMSSD по шумным ${Math.sqrt(nz.diffVar).toFixed(0)} → с поправкой ${c.rmssd.toFixed(0)} (настоящий ${rmssdTrue.toFixed(0)}) ✓`)
}

// pNN50: пары только из соседних принятых интервалов
assert.equal(pnn50([800, 900, 800, 810], [true, true, true, true]), (2 / 3) * 100)
assert.equal(pnn50([800, 900, 800, 810], [true, false, true, true]), 0)

// Спектр: интервалы колеблются с частотой дыхания 0,25 Гц — почти вся мощность в HF
const t = []
const nn = []
let acc = 0
for (let i = 0; i < 380; i++) {
  const v = 790 + 40 * Math.sin(2 * Math.PI * 0.25 * (acc / 1000))
  acc += v
  t.push(acc / 1000)
  nn.push(v)
}
const s = bandShares(t, nn)
assert.ok(s.hfPct > 90, 'HF ' + s.hfPct)
console.log(`— спектр: колебание 0,25 Гц → HF ${s.hfPct.toFixed(0)} % ✓`)

console.log('Все проверки пройдены')
