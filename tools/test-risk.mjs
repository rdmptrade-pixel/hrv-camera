// Проверка модели адаптационного риска на средних значениях групп из книги (табл. 3.3, с. 112)
// и проверка спектра на сигнале с известной частотой.
// Запуск: node tools/test-risk.mjs

import assert from 'node:assert/strict'
import { adaptationRisk, regulationType, pnn50, RISK } from '../lib/risk.js'
import { bandShares } from '../lib/spectrum.js'

// Тип регуляции задаём напрямую (в таблице книги нет RMSSD/SDNN/CV)
const withType = (i) => ({ ...RISK, TYPES: RISK.TYPES.map((t, k) => ({ ...t, c: k === i ? 1e6 : -1e6 })) })
const GROUPS = [
  // название, [ЧСС, ИН, pNN50, HF%], ожидаемое состояние, допустимые категории
  ['норма', [75.4, 124.0, 12.24, 23.25], 'норма', [1, 2]],
  ['донозологические', [82.4, 320.5, 1.88, 18.17], 'донозологическое', [2, 3, 4]],
  ['преморбидные', [80.9, 636.7, 0.4, 19.01], 'преморбидное', [7, 8]],
  ['патологические', [94.8, 1374.3, 0.57, 13.2], 'патологическое', [10]],
]
for (const [name, [hr, si, p, hf], state, cats] of GROUPS) {
  for (const typeIdx of [1, 3]) {
    const r = adaptationRisk({ hr, si, pnn50: p, hfPct: hf, rmssd: 30, sdnn: 30, cv: 5 }, withType(typeIdx))
    assert.equal(r.topState, state, `${name}, тип ${typeIdx + 1}: состояние`)
    assert.ok(cats.includes(r.category), `${name}, тип ${typeIdx + 1}: категория ${r.category}`)
  }
  console.log(`— группа «${name}» → ${state} ✓`)
}

// ФР и СН по с. 114 на средних группы нормы: книга, рис. 3.11 — около (1,9; −0,35)
const n = adaptationRisk({ hr: 75.4, si: 124, pnn50: 12.24, hfPct: 23.25, rmssd: 30, sdnn: 30, cv: 5 })
assert.ok(Math.abs(n.fr - 1.87) < 0.01 && Math.abs(n.sn + 0.31) < 0.01)
console.log('— ФР и СН нормы совпадают с рис. 3.11 ✓')

// Тип регуляции. Числа согласованы между собой: CV = SDNN / средний интервал · 100.
// Ваготония: пульс 50 (интервал 1200 мс), большая вариабельность, низкий ИН
assert.equal(regulationType({ si: 30, rmssd: 90, sdnn: 90, cv: 7.5 }).key, 'I')
// Симпатотония: пульс 100 (интервал 600 мс), малая вариабельность, высокий ИН
assert.equal(regulationType({ si: 600, rmssd: 10, sdnn: 15, cv: 2.5 }).key, 'IV')
console.log('— тип регуляции ✓')

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
