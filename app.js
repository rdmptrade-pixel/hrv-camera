// Основное приложение: замер 5 минут, индекс Баевского, история.
import { CameraRecorder } from './lib/camera.js'
import { BeatDetector, median } from './lib/signal.js'
import { buildResult, qualityLabel } from './lib/result.js'
import { loadHistory, saveToHistory, clearHistory, toCsv } from './lib/history.js'

const APP = {
  MEASURE_MS: 5 * 60 * 1000, // длительность замера — как требует метод
  WAVE_WINDOW_MS: 6000, // сколько секунд волны рисовать
  TREND_DAYS: 7, // средний индекс за последние дни — для сравнения
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

const fmtDate = (iso) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const qClass = (q) => 'q-' + q

// ---------- Главная ----------

function renderHome() {
  const list = loadHistory()
  const last = list[list.length - 1]
  if (last) {
    $('last').hidden = false
    $('last').innerHTML =
      '<div class="muted">Последний замер · ' + fmtDate(last.date) + '</div>' +
      '<div style="font-size:28px;font-weight:700">ИН ' + (last.si ?? '—') + '</div>' +
      '<div>' + last.zone + ' · пульс ' + (last.hr ?? '—') + '</div>' +
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

function onFrame(f) {
  frames.push([Math.round(f.t * 100) / 100, Math.round(f.r * 100) / 100, Math.round(f.g * 100) / 100])
  const b = detector.push(f.t, f.r)
  if (b !== null && f.finger) liveBeats.push(b)
  $('finger').innerHTML = f.finger ? '<span class="q-good">Палец на месте</span>' : '<span class="q-fair">Закройте пальцем камеру и вспышку</span>'
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

function renderResult(r) {
  $('r-si').textContent = r.si ?? '—'
  $('r-zone').textContent = r.zone
  $('r-quality').innerHTML = '<span class="' + qClass(r.quality) + '">Качество замера: ' + qualityLabel(r.quality) + '</span>'
  const recent = loadHistory().filter((h) => h.quality !== 'bad' && h.si !== null && h.date !== r.date && Date.now() - new Date(h.date) < APP.TREND_DAYS * 864e5)
  $('r-compare').textContent = recent.length
    ? 'Средний ИН за ' + APP.TREND_DAYS + ' дней: ' + Math.round(recent.reduce((a, h) => a + h.si, 0) / recent.length) + ' (замеров: ' + recent.length + ')'
    : 'Для сравнения пока мало замеров. Смотрите на тенденцию за несколько дней, а не на один замер.'
  const cell = (label, value) => '<div><span>' + label + '</span>' + value + '</div>'
  $('r-grid').innerHTML =
    cell('Пульс', r.hr ?? '—') +
    cell('Интервалов принято', r.intervals + ' (' + r.accepted + ' %)') +
    cell('Mo — самый частый интервал', (r.mo ?? '—') + ' с') +
    cell('AMo — его доля', (r.amo ?? '—') + ' %') +
    cell('MxDMn — размах', (r.mxdmn ?? '—') + ' с') +
    cell('SDNN', (r.sdnn ?? '—') + ' мс') +
    cell('RMSSD', (r.rmssd ?? '—') + ' мс') +
    cell('Годных кадров', r.goodFrames + ' %')
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
    '<tr><th>Дата</th><th class="num">ИН</th><th class="num">Пульс</th><th>Качество</th></tr>' +
    list.map((h) => '<tr><td>' + fmtDate(h.date) + '</td><td class="num">' + (h.si ?? '—') + '</td><td class="num">' + (h.hr ?? '—') + '</td><td class="' + qClass(h.quality) + '">' + qualityLabel(h.quality).split(' ')[0] + '</td></tr>').join('')
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
