// Проверка поиска ударов на искусственной пульсовой волне с известными интервалами.
// Запуск: node tools/test-signal.mjs

import assert from 'node:assert/strict'
import { BeatDetector, meanSd } from '../lib/signal.js'

let seed = 7
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const noise = (amp) => (rnd() * 2 - 1) * amp

// Генерация: истинные удары, по каждому — затемнение пальца (форма пульсовой волны),
// камера ~30 кадров/с с дрожанием времени кадра, дрейф яркости и шум
function simulate({ baseRr = 850, rrSwing = 60, seconds = 300, fps = 30, jitterMs = 3, noiseAmp = 0.15 }) {
  const beats = []
  let t = 500
  let i = 0
  while (t < seconds * 1000) {
    beats.push(t)
    t += baseRr + rrSwing * Math.sin(i / 4) + noise(15)
    i++
  }
  const frames = []
  for (let f = 0; f * (1000 / fps) < seconds * 1000; f++) {
    const ft = f * (1000 / fps) + noise(jitterMs)
    let pulse = 0
    for (const b of beats) {
      const d = ft - b
      if (d < -100 || d > 700) continue
      // Плавный подъём за 150 мс (как у настоящей пульсовой волны) и медленный спад
      pulse += d < 0 ? 0 : d < 150 ? (1 - Math.cos((Math.PI * d) / 150)) / 2 : Math.exp(-(d - 150) / 200)
    }
    const drift = 5 * Math.sin(ft / 7000)
    frames.push({ t: ft, v: 200 + drift - 2 * pulse + noise(noiseAmp) })
  }
  return { beats, frames }
}

function run(name, opts, maxErrMs) {
  const { beats, frames } = simulate(opts)
  const det = new BeatDetector()
  const found = []
  for (const f of frames) {
    const b = det.push(f.t, f.v)
    if (b !== null) found.push(b)
  }
  // Каждому настоящему удару — ближайший найденный (волна сдвинута относительно удара
  // на постоянную величину, на интервалы это не влияет). Лишние находки в начале не сбивают сравнение
  const nearest = (b) => found.reduce((best, f) => (Math.abs(f - b - 75) < Math.abs(best - b - 75) ? f : best), found[0])
  const matched = beats.map(nearest)
  const errs = []
  for (let i = 3; i < beats.length - 1; i++) {
    errs.push(Math.abs(matched[i] - matched[i - 1] - (beats[i] - beats[i - 1])))
  }
  const e = meanSd(errs)
  console.log(`— ${name}: ударов ${beats.length}, найдено ${found.length}, ошибка интервала ср ${e.mean.toFixed(1)} мс, макс ${Math.max(...errs).toFixed(0)} мс`)
  assert.ok(Math.abs(found.length - beats.length) <= 2, name + ': число ударов')
  assert.ok(e.mean <= maxErrMs, name + ': средняя ошибка интервала')
}

run('пульс ~70, 30 кадров/с', {}, 10)
run('пульс ~60, 30 кадров/с', { baseRr: 1000 }, 10)
run('пульс ~90, 30 кадров/с, больше шума', { baseRr: 667, rrSwing: 30, noiseAmp: 0.3 }, 15)
run('пульс ~70, 24 кадра/с', { fps: 24 }, 14)

console.log('Все проверки пройдены')
