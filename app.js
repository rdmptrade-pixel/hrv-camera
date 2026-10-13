// Основное приложение: замер 5 минут, индекс Баевского, история.
import { CameraRecorder } from './lib/camera.js'
import { BeatDetector, median } from './lib/signal.js'
import { buildResult, qualityLabel } from './lib/result.js'
import { loadHistory, saveToHistory, clearHistory, toCsv } from './lib/history.js'
import { BAEVSKY } from './lib/baevsky.js'
import { RISK } from './lib/risk.js'

const APP = {
  MEASURE_MS: 5 * 60 * 1000, // длительность замера — как требует метод
  WAVE_WINDOW_MS: 6000, // сколько секунд волны рисовать
  TREND_DAYS: 7, // средний индекс за последние дни — для сравнения
  GROUP_MIN: 7, // группа риска — по среднему не меньше чем 7 хороших замеров…
  GROUP_MAX: 14, // …и не больше чем 14 последних
  TREND_RECENT: 3, // тенденция: 3 последних замера против предыдущих
  SNR_GOOD: 12, // сила пульса относительно шума яркости: от 12 — хорошая
  SNR_FAIR: 7, // 7–12 — средняя, ниже — слабая (точность ударов падает)
  SNR_WINDOW_MS: 3000, // за сколько последних секунд оценивать силу пульса
}

const $ = (id) => document.getElementById(id)
const screens = ['home', 'measure', 'result', 'history']
function show(name) {
  for (const s of screens) $(s).hidden = s !== name
  window.scrollTo(0, 0)
}

const recorder = new CameraRecorder($('video'))
let frames = []
let detector = null
let liveBeats = []
let startedAt = 0
let timer = null
let wakeLock = null
let lastFile = null
let snrBuf = [] // последние секунды: время и яркость — для оценки силы пульса

const fmtDate = (iso) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const qClass = (q) => 'q-' + q

// Зона по значению ИН — заново по текущей шкале (так раскрашиваются и старые замеры)
const zoneFor = (si) => (si === null || si === undefined ? null : BAEVSKY.ZONES.find((z) => si <= z.max))
const dot = (si) => {
  const z = zoneFor(si)
  return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (z ? z.color : '#777') + ';margin-right:6px"></span>'
}

// Цветная шкала: шесть равных отрезков с границами 50 · 80 · 150 · 300 · 500, отметка — где ваш ИН
function scaleHtml(si) {
  const zones = BAEVSKY.ZONES
  const seg = 100 / zones.length
  let pos = null
  if (si !== null && si !== undefined) {
    const i = zones.findIndex((z) => si <= z.max)
    const lo = i ? zones[i - 1].max : 0
    const hi = Number.isFinite(zones[i].max) ? zones[i].max : 1000
    pos = (i + Math.min(1, (si - lo) / (hi - lo))) * seg
  }
  const bars = zones.map((z) => '<div style="flex:1;background:' + z.color + '"></div>').join('')
  const ticks = zones.slice(0, -1).map((z, i) => '<span style="position:absolute;left:' + (i + 1) * seg + '%;transform:translateX(-50%)">' + z.max + '</span>').join('')
  const marker = pos === null ? '' : '<div style="position:absolute;left:' + pos + '%;top:-6px;width:4px;height:26px;margin-left:-2px;background:#fff;border-radius:2px;box-shadow:0 0 0 1px #000"></div>'
  return '<div style="position:relative;margin:14px 0 4px"><div style="display:flex;height:14px;border-radius:7px;overflow:hidden">' + bars + '</div>' + marker + '</div>' +
    '<div class="muted" style="position:relative;height:18px;font-size:12px">' + ticks + '</div>'
}

// ---------- Адаптационный риск ----------

const riskZone = (cat) => RISK.ZONES.find((z) => cat <= z.max)

// Лестница 1–10 со светофором, текущая категория выделена
function ladderHtml(cat) {
  return '<div style="display:flex;gap:3px;margin:10px 0 4px">' +
    Array.from({ length: 10 }, (_, i) => {
      const z = riskZone(i + 1)
      const on = i + 1 === cat
      return '<div style="flex:1;text-align:center;padding:6px 0;border-radius:6px;font-weight:700;background:' + z.color +
        ';opacity:' + (on ? 1 : 0.28) + ';color:#111;' + (on ? 'outline:3px solid #fff' : '') + '">' + (i + 1) + '</div>'
    }).join('') + '</div>'
}

// Полоса вероятностей четырёх состояний
function probsHtml(four) {
  const parts = [['норма', '#43a047'], ['донозологическое', '#fdd835'], ['преморбидное', '#fb8c00'], ['срыв адаптации', '#e53935']]
  const bar = parts.map(([, c], i) => (four[i] ? '<div style="width:' + four[i] + '%;background:' + c + '"></div>' : '')).join('')
  const legend = parts.map(([n, c], i) => '<span style="margin-right:10px;white-space:nowrap"><span style="display:inline-block;width:9px;height:9px;background:' + c + ';margin-right:4px"></span>' + n + ' ' + four[i] + '%</span>').join('')
  return '<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;margin:10px 0 6px">' + bar + '</div><div class="muted" style="font-size:13px">' + legend + '</div>'
}

const NOISE_TEXT = { good: 'мало', fair: 'средне — показатели взяты с поправкой', bad: 'много — оценка ненадёжна, повторите замер с более лёгким нажимом' }

function noiseHtml(r) {
  if (r.noise === undefined || r.noise === null) return ''
  const cls = r.noiseLevel === 'good' ? 'q-good' : r.noiseLevel === 'fair' ? 'q-fair' : 'q-bad'
  return '<div class="' + cls + '" style="margin-top:6px">Шум камеры ±' + r.noise + ' мс — ' + NOISE_TEXT[r.noiseLevel] + '</div>'
}

function riskHtml(r) {
  if (!r.risk) return '<div class="muted">Адаптационный риск для этого замера не посчитан (замер сделан до обновления или в нём мало данных).</div>'
  const k = r.risk
  const z = riskZone(k.category)
  return '<div class="muted">Категория адаптационного риска сегодня (модель Баевского)</div>' +
    '<div style="display:flex;align-items:baseline;gap:10px"><span class="big" style="color:' + z.color + '">' + k.category + '</span><span class="muted">из 10</span></div>' +
    '<div class="zone">' + z.label + ' — ' + z.advice + '</div>' +
    ladderHtml(k.category) + probsHtml(k.four) + noiseHtml(r) +
    '<div class="muted" style="font-size:13px;margin-top:6px">Функциональные резервы (ФР) ' + k.fr + ', степень напряжения (СН) ' + k.sn + '. У здоровых людей по кардиограмме в среднем ФР ≈ 2,3, СН ≈ −1,2…−1,6 (ИМБП, «Марс-500»).</div>' +
    '<div class="muted" style="font-size:12px;margin-top:8px">Один замер показывает состояние на сегодня: у здоровых людей оно меняется от простуды, командировки, стресса. Свою группу риска смотрите по среднему за много замеров. ' +
    'Источники: монография (гл. 3.2, Баевский, Черникова, с. 105–116), патенты RU 2448644 и RU 2586041. Выбор категории по вероятностям — правило приложения (осторожное, совпадает с примерами патента). ' +
    'Камера намного менее точна, чем кардиограмма: показатели взяты с поправкой на её шум. Модель построена на людях 30–70 лет. Это не диагноз.</div>'
}

// Группа риска — по среднему категорий последних хороших замеров, со стрелкой тенденции
function groupHtml(list) {
  const ok = list.filter((h) => h.risk && h.quality !== 'bad' && h.noiseLevel !== 'bad')
  if (ok.length < APP.GROUP_MIN) {
    return '<div class="muted">Ваша группа риска появится после ' + APP.GROUP_MIN + ' хороших замеров (сейчас ' + ok.length + '). Лучше мерить каждый день утром.</div>'
  }
  const last = ok.slice(-APP.GROUP_MAX)
  const cats = last.map((h) => h.risk.category)
  const mean = cats.reduce((a, v) => a + v, 0) / cats.length
  const cat = Math.min(10, Math.max(1, Math.round(mean + 1e-9)))
  const z = riskZone(cat)
  const recent = cats.slice(-APP.TREND_RECENT)
  const before = cats.slice(0, -APP.TREND_RECENT)
  const diff = recent.reduce((a, v) => a + v, 0) / recent.length - before.reduce((a, v) => a + v, 0) / before.length
  const trend = diff >= 1 ? '<span class="q-bad">↑ риск растёт</span>' : diff <= -1 ? '<span class="q-good">↓ риск снижается</span>' : '<span class="muted">→ без заметных изменений</span>'
  return '<div class="muted">Ваша группа риска (среднее за ' + cats.length + ' замеров)</div>' +
    '<div style="font-size:24px;font-weight:700;color:' + z.color + '">' + cat + ' — ' + z.label + '</div>' +
    '<div>' + trend + '</div>'
}

// Плоскость «ФР — СН» с четырьмя зонами и траекторией замеров
function drawPhase(canvas, list) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  const X = [-6, 4]
  const Y = [-3, 1.5]
  const px = (fr) => ((Math.max(X[0], Math.min(X[1], fr)) - X[0]) / (X[1] - X[0])) * W
  const py = (sn) => H - ((Math.max(Y[0], Math.min(Y[1], sn)) - Y[0]) / (Y[1] - Y[0])) * H
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const quad = [
    [0, 4, -3, 0, 'rgba(67,160,71,.22)', 'норма'],
    [0, 4, 0, 1.5, 'rgba(253,216,53,.18)', 'донозологические'],
    [-6, 0, 0, 1.5, 'rgba(251,140,0,.2)', 'преморбидные'],
    [-6, 0, -3, 0, 'rgba(229,57,53,.2)', 'патологические'],
  ]
  ctx.font = '18px system-ui'
  for (const [x0, x1, y0, y1, c, label] of quad) {
    ctx.fillStyle = c
    ctx.fillRect(px(x0), py(y1), px(x1) - px(x0), py(y0) - py(y1))
    ctx.fillStyle = '#aaa'
    ctx.fillText(label, px(x0) + 8, y1 > 0 ? py(y1) + 22 : py(y0) - 10)
  }
  ctx.strokeStyle = '#666'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px(0), 0)
  ctx.lineTo(px(0), H)
  ctx.moveTo(0, py(0))
  ctx.lineTo(W, py(0))
  ctx.stroke()
  ctx.fillStyle = '#888'
  ctx.font = '15px system-ui'
  ctx.fillText('ФР — резервы →', W - 130, py(0) - 6)
  ctx.fillText('↑ СН — напряжение', px(0) + 6, 16)
  const pts = list.filter((h) => h.risk && h.quality !== 'bad')
  if (!pts.length) return
  ctx.strokeStyle = 'rgba(255,255,255,.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  pts.forEach((h, i) => (i ? ctx.lineTo(px(h.risk.fr), py(h.risk.sn)) : ctx.moveTo(px(h.risk.fr), py(h.risk.sn))))
  ctx.stroke()
  pts.forEach((h, i) => {
    const last = i === pts.length - 1
    ctx.globalAlpha = last ? 1 : 0.35 + (0.5 * i) / pts.length
    ctx.fillStyle = riskZone(h.risk.category).color
    ctx.beginPath()
    ctx.arc(px(h.risk.fr), py(h.risk.sn), last ? 10 : 6, 0, 2 * Math.PI)
    ctx.fill()
    if (last) {
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 3
      ctx.stroke()
    }
  })
  ctx.globalAlpha = 1
}

// ---------- Главная ----------

function renderHome() {
  const list = loadHistory()
  const last = list[list.length - 1]
  if (last) {
    $('last').hidden = false
    $('last').innerHTML =
      '<div class="muted">Последний замер · ' + fmtDate(last.date) + '</div>' +
      '<div style="font-size:28px;font-weight:700;color:' + (zoneFor(last.si) || { color: '#eee' }).color + '">ИН ' + (last.si ?? '—') + '</div>' +
      '<div>' + (zoneFor(last.si) || { label: '—' }).label + ' · пульс ' + (last.hr ?? '—') + '</div>' +
      scaleHtml(last.si) +
      (last.risk ? '<div>Адаптационный риск сегодня: <b style="color:' + riskZone(last.risk.category).color + '">' + last.risk.category + ' из 10</b> — ' + riskZone(last.risk.category).label + '</div>' + ladderHtml(last.risk.category) : '') +
      noiseHtml(last) +
      '<div style="margin-top:10px">' + groupHtml(list) + '</div>' +
      '<div class="' + qClass(last.quality) + '">Качество: ' + qualityLabel(last.quality) + '</div>'
  } else $('last').hidden = true
  if (!CameraRecorder.supported()) {
    $('unsupported').hidden = false
    $('start').disabled = true
  }
}

// ---------- Замер ----------

function drawWave() {
  const c = $('wave')
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, c.width, c.height)
  const { t, y } = detector.wave()
  if (t.length < 2) return
  const tEnd = t[t.length - 1]
  let min = Infinity
  let max = -Infinity
  for (const v of y) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min || 1
  ctx.strokeStyle = '#e53935'
  ctx.lineWidth = 2
  ctx.beginPath()
  t.forEach((ti, i) => {
    const x = c.width - ((tEnd - ti) / APP.WAVE_WINDOW_MS) * c.width
    const yy = c.height - 8 - ((y[i] - min) / span) * (c.height - 16)
    if (i) ctx.lineTo(x, yy)
    else ctx.moveTo(x, yy)
  })
  ctx.stroke()
}

// Сила пульса: размах волны за последние секунды относительно шума яркости кадров
function pulseStrength(t) {
  while (snrBuf.length && t - snrBuf[0][0] > APP.SNR_WINDOW_MS) snrBuf.shift()
  if (snrBuf.length < 30) return null
  let s2 = 0
  for (let i = 1; i < snrBuf.length - 1; i++) {
    const r = snrBuf[i][1] - (snrBuf[i - 1][1] + snrBuf[i + 1][1]) / 2
    s2 += r * r
  }
  const noise = Math.sqrt(s2 / (snrBuf.length - 2) / 1.5)
  const { y } = detector.wave()
  const recent = y.slice(-Math.round(snrBuf.length * 0.9))
  const amp = Math.max(...recent) - Math.min(...recent)
  return noise > 0 ? amp / noise : null
}

function onFrame(f) {
  frames.push([Math.round(f.t * 100) / 100, Math.round(f.r * 100) / 100, Math.round(f.g * 100) / 100])
  snrBuf.push([f.t, f.r])
  const b = detector.push(f.t, f.r)
  if (b !== null && f.finger) liveBeats.push(b)
  if (!f.finger) $('finger').innerHTML = '<span class="q-fair">Закройте пальцем камеру и вспышку</span>'
  else {
    const snr = pulseStrength(f.t)
    $('finger').innerHTML = snr === null ? '<span class="q-good">Палец на месте</span>'
      : snr >= APP.SNR_GOOD ? '<span class="q-good">Сила пульса хорошая (' + snr.toFixed(0) + ')</span>'
      : snr >= APP.SNR_FAIR ? '<span class="q-fair">Сила пульса средняя (' + snr.toFixed(0) + ') — попробуйте нажимать ещё легче</span>'
      : '<span class="q-bad">Пульс слабый (' + snr.toFixed(0) + ') — ослабьте нажим, палец лишь касается камеры</span>'
  }
  drawWave()
}

function tick() {
  const left = Math.max(0, APP.MEASURE_MS - (performance.now() - startedAt))
  const s = Math.ceil(left / 1000)
  $('countdown').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
  const rr = liveBeats.slice(-11).map((b, i, a) => (i ? b - a[i - 1] : null)).filter((v) => v !== null)
  $('live').textContent = 'Пульс: ' + (rr.length >= 3 ? Math.round(60000 / median(rr)) : '—')
  if (left <= 0) finishMeasure()
}

async function startMeasure(deviceId = null) {
  show('measure')
  frames = []
  liveBeats = []
  snrBuf = []
  detector = new BeatDetector()
  try {
    const info = await recorder.start(onFrame, deviceId)
    const cams = await recorder.cameras()
    $('camera').innerHTML = cams
      .map((d, i) => '<option value="' + d.deviceId + '"' + (d.deviceId === info.deviceId ? ' selected' : '') + '>' + (d.label || 'Камера ' + (i + 1)) + '</option>')
      .join('')
    if (!info.torch) $('finger').innerHTML = '<span class="q-bad">Вспышка не включилась — выберите другую камеру ниже</span>'
  } catch (e) {
    alert('Камера не открылась (' + e.name + '). Разрешите доступ к камере в настройках сайта.')
    stopMeasure()
    show('home')
    return
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen')
  } catch (e) {
    wakeLock = null
  }
  startedAt = performance.now()
  clearInterval(timer)
  timer = setInterval(tick, 500)
}

function stopMeasure() {
  clearInterval(timer)
  timer = null
  recorder.stop()
  if (wakeLock) wakeLock.release().catch(() => {})
  wakeLock = null
}

function finishMeasure() {
  stopMeasure()
  if (navigator.vibrate) navigator.vibrate([300, 150, 300])
  const result = buildResult(frames)
  saveToHistory(result)
  lastFile = new File(
    [JSON.stringify({ version: 1, recordedAt: result.date, durationMs: APP.MEASURE_MS, info: recorder.info, userAgent: navigator.userAgent, columns: ['t_ms', 'red', 'green'], frames })],
    'pulse-' + result.date.slice(0, 16).replace(/[:T]/g, '-') + '.json',
    { type: 'application/json' }
  )
  renderResult(result)
  show('result')
}

// ---------- Результат ----------

function drawHistogram(hist) {
  const c = $('hist')
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, c.width, c.height)
  if (!hist.length) return
  const total = hist.reduce((a, [, v]) => a + v, 0)
  const maxV = Math.max(...hist.map(([, v]) => v))
  const w = c.width / hist.length
  ctx.font = '20px system-ui'
  ctx.textAlign = 'center'
  hist.forEach(([bin, v], i) => {
    const h = (v / maxV) * (c.height - 50)
    ctx.fillStyle = v === maxV ? '#e53935' : '#777'
    ctx.fillRect(i * w + 3, c.height - 24 - h, w - 6, h)
    ctx.fillStyle = '#bbb'
    ctx.fillText(String(bin), i * w + w / 2, c.height - 4)
    ctx.fillText(Math.round((v / total) * 100) + '%', i * w + w / 2, c.height - 30 - h)
  })
}

// Значение по камере без поправки на шум — мелко, для сравнения
const rawNote = (r, key, unit) => (r.raw && r.raw[key] !== undefined && r.raw[key] !== null ? '<span style="display:inline;color:#888;font-size:12px"> (по камере ' + r.raw[key] + unit + ')</span>' : '')

function renderResult(r) {
  const z = zoneFor(r.si)
  $('r-si').textContent = r.si ?? '—'
  $('r-si').style.color = z ? z.color : '#eee'
  $('r-zone').innerHTML = (z ? z.label : '—') + scaleHtml(r.si) +
    '<div class="muted" style="font-size:12px">Норма 80–150 — по методичке Баевского (2001). Остальные границы — ориентиры приложения.</div>'
  $('r-quality').innerHTML = '<span class="' + qClass(r.quality) + '">Качество замера: ' + qualityLabel(r.quality) + '</span>'
  const recent = loadHistory().filter((h) => h.quality !== 'bad' && h.si !== null && h.date !== r.date && Date.now() - new Date(h.date) < APP.TREND_DAYS * 864e5)
  $('r-compare').textContent = recent.length
    ? 'Средний ИН за ' + APP.TREND_DAYS + ' дней: ' + Math.round(recent.reduce((a, h) => a + h.si, 0) / recent.length) + ' (замеров: ' + recent.length + ')'
    : 'Для сравнения пока мало замеров. Смотрите на тенденцию за несколько дней, а не на один замер.'
  $('r-risk').innerHTML = riskHtml(r) + '<div style="margin-top:12px">' + groupHtml(loadHistory()) + '</div>'
  drawPhase($('phase'), loadHistory())
  const cell = (label, value) => '<div><span>' + label + '</span>' + value + '</div>'
  $('r-grid').innerHTML =
    cell('Пульс', r.hr ?? '—') +
    cell('Интервалов принято', r.intervals + ' (' + r.accepted + ' %)') +
    cell('Mo — самый частый интервал', (r.mo ?? '—') + ' с') +
    cell('AMo — его доля', (r.amo ?? '—') + ' %') +
    cell('MxDMn — размах', (r.mxdmn ?? '—') + ' с') +
    cell('SDNN', (r.sdnn ?? '—') + ' мс' + rawNote(r, 'sdnn', ' мс')) +
    cell('RMSSD', (r.rmssd ?? '—') + ' мс' + rawNote(r, 'rmssd', ' мс')) +
    cell('pNN50', (r.pnn50 ?? '—') + ' %' + rawNote(r, 'pnn50', ' %')) +
    cell('CV — коэффициент вариации', (r.cv ?? '—') + ' %') +
    cell('Спектр VLF / LF / HF', (r.vlfPct ?? '—') + ' / ' + (r.lfPct ?? '—') + ' / ' + (r.hfPct ?? '—') + ' %') +
    cell('Годных кадров', r.goodFrames + ' %') +
    cell('Сила пульса к шуму', r.snr ?? '—')
  drawHistogram(r.histogram)
}

// ---------- История ----------

function renderHistory() {
  const list = loadHistory().slice().reverse()
  const ok = list.filter((h) => h.quality !== 'bad' && h.si !== null)
  const week = ok.filter((h) => Date.now() - new Date(h.date) < APP.TREND_DAYS * 864e5)
  $('h-summary').innerHTML = list.length
    ? 'Замеров: ' + list.length + '. Средний ИН за ' + APP.TREND_DAYS + ' дней: ' + (week.length ? Math.round(week.reduce((a, h) => a + h.si, 0) / week.length) : '—') +
      '<div class="muted">Плохие по качеству замеры в среднее не входят.</div>'
    : 'Замеров пока нет.'
  $('h-table').innerHTML =
    '<tr><th>Дата</th><th class="num">Риск</th><th class="num">ИН</th><th class="num">Пульс</th><th>Качество</th></tr>' +
    list.map((h) => '<tr><td>' + fmtDate(h.date) + '</td><td class="num">' + (h.risk ? '<b style="color:' + riskZone(h.risk.category).color + '">' + h.risk.category + '</b>' : '—') + '</td><td class="num">' + dot(h.si) + (h.si ?? '—') + '</td><td class="num">' + (h.hr ?? '—') + '</td><td class="' + qClass(h.quality) + '">' + qualityLabel(h.quality).split(' ')[0] + '</td></tr>').join('')
  drawPhase($('h-phase'), loadHistory())
}

function download(file) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

async function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return
    } catch (e) {
      if (e.name === 'AbortError') return
    }
  }
  download(file)
}

// ---------- Кнопки ----------

$('start').addEventListener('click', () => startMeasure())
$('camera').addEventListener('change', () => startMeasure($('camera').value))
$('cancel').addEventListener('click', () => {
  stopMeasure()
  renderHome()
  show('home')
})
$('to-home').addEventListener('click', () => {
  renderHome()
  show('home')
})
$('share-rec').addEventListener('click', () => lastFile && shareOrDownload(lastFile))
$('open-history').addEventListener('click', () => {
  renderHistory()
  show('history')
})
$('back').addEventListener('click', () => {
  renderHome()
  show('home')
})
$('export').addEventListener('click', () => {
  const name = 'hrv-history-' + new Date().toISOString().slice(0, 10) + '.csv'
  shareOrDownload(new File([toCsv(loadHistory())], name, { type: 'text/csv' }))
})
$('clear').addEventListener('click', () => {
  if (confirm('Удалить всю историю замеров с этого телефона? Отменить будет нельзя.')) {
    clearHistory()
    renderHistory()
  }
})

// Работа без интернета: после первого открытия файлы сохраняются в телефоне
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})

renderHome()
