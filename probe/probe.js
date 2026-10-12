// Страница-проверка: камера + вспышка, частота кадров, пульсовая волна с пальца.
import { BeatDetector, median, meanSd } from '../lib/signal.js'

const PROBE = {
  DURATION_MS: 60 * 1000, // длительность проверки
  RECORD_MS: 5 * 60 * 1000, // длительность записи для настройки обработки
  SAMPLE_W: 32, // кадр уменьшаем до 32×24 — для средней яркости этого достаточно
  SAMPLE_H: 24,
  FINGER_MIN_RED: 100, // палец на камере со вспышкой: красный канал яркий…
  FINGER_RED_TO_GREEN: 1.8, // …и намного ярче зелёного
  WAVE_WINDOW_MS: 6000, // сколько секунд волны рисовать
  DROP_GAP_MS: 50, // промежуток между кадрами больше этого — кадр потерян
  GOOD_FPS: 25, // нижняя граница частоты кадров для замера
  GOOD_FINGER_SHARE: 0.8, // палец должен лежать правильно хотя бы 80 % времени
}

const $ = (id) => document.getElementById(id)
const video = $('video')
const waveCanvas = $('wave')
const sample = document.createElement('canvas')
sample.width = PROBE.SAMPLE_W
sample.height = PROBE.SAMPLE_H
const sctx = sample.getContext('2d', { willReadFrequently: true })

let stream = null
let track = null
let running = false
let session = 0 // номер запуска: кадры от прошлого запуска (после смены камеры) отбрасываются
let startedAt = 0
let detector = null
let frameTimes = []
let fingerFrames = 0
let beats = []
let timeSource = ''
let wakeLock = null
let info = {}
let durationMs = PROBE.DURATION_MS
let raw = [] // сырой сигнал: [время кадра, красный, зелёный] — для настройки обработки на сервере
let recordFile = null

function setStatus(html) {
  $('status').innerHTML = html
}

async function listCameras(currentId) {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
  const sel = $('camera')
  sel.innerHTML = ''
  devices.forEach((d, i) => {
    const o = document.createElement('option')
    o.value = d.deviceId
    o.textContent = d.label || 'Камера ' + (i + 1)
    if (d.deviceId === currentId) o.selected = true
    sel.appendChild(o)
  })
  sel.disabled = false
  return devices
}

async function openCamera(deviceId) {
  if (stream) stream.getTracks().forEach((t) => t.stop())
  const video0 = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
  const constraints = { audio: false, video: deviceId ? { ...video0, deviceId: { exact: deviceId } } : { ...video0, facingMode: { ideal: 'environment' } } }
  stream = await navigator.mediaDevices.getUserMedia(constraints)
  track = stream.getVideoTracks()[0]
  video.srcObject = stream
  await video.play()

  const caps = track.getCapabilities ? track.getCapabilities() : {}
  const settings = track.getSettings()
  let torch = false
  if (caps.torch) {
    try {
      await track.applyConstraints({ advanced: [{ torch: true }] })
      torch = true
    } catch (e) {
      torch = false
    }
  }
  info = {
    camera: track.label,
    torch,
    torchSupported: !!caps.torch,
    resolution: settings.width + '×' + settings.height,
    frameRateSetting: settings.frameRate,
    frameRateMax: caps.frameRate ? caps.frameRate.max : undefined,
  }
  return settings.deviceId
}

function drawWave() {
  const ctx = waveCanvas.getContext('2d')
  const W = waveCanvas.width
  const H = waveCanvas.height
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
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
    const x = W - ((tEnd - ti) / PROBE.WAVE_WINDOW_MS) * W
    const yy = H - 10 - ((y[i] - min) / span) * (H - 20)
    if (i === 0) ctx.moveTo(x, yy)
    else ctx.lineTo(x, yy)
  })
  ctx.stroke()
  // Отметки найденных ударов
  ctx.fillStyle = '#fff'
  for (const b of beats) {
    if (tEnd - b > PROBE.WAVE_WINDOW_MS) continue
    ctx.fillRect(W - ((tEnd - b) / PROBE.WAVE_WINDOW_MS) * W - 1, 0, 2, 8)
  }
}

function onFrame(now, meta, id) {
  if (!running || id !== session) return
  // Время кадра: время съёмки, если браузер его даёт, иначе время кадра в потоке
  let t
  if (meta && meta.captureTime) {
    t = meta.captureTime
    timeSource = 'время съёмки'
  } else if (meta && meta.mediaTime) {
    t = meta.mediaTime * 1000
    timeSource = 'время кадра в потоке'
  } else {
    t = now
    timeSource = 'время отрисовки'
  }

  sctx.drawImage(video, 0, 0, PROBE.SAMPLE_W, PROBE.SAMPLE_H)
  const px = sctx.getImageData(0, 0, PROBE.SAMPLE_W, PROBE.SAMPLE_H).data
  let r = 0
  let g = 0
  for (let i = 0; i < px.length; i += 4) {
    r += px[i]
    g += px[i + 1]
  }
  const n = px.length / 4
  r /= n
  g /= n

  const finger = r >= PROBE.FINGER_MIN_RED && r >= PROBE.FINGER_RED_TO_GREEN * g
  if (finger) fingerFrames++
  frameTimes.push(t)
  raw.push([Math.round(t * 100) / 100, Math.round(r * 100) / 100, Math.round(g * 100) / 100])
  const beat = detector.push(t, r)
  if (beat !== null && finger) beats.push(beat)

  drawWave()
  const elapsed = performance.now() - startedAt
  const left = Math.max(0, Math.ceil((durationMs - elapsed) / 1000))
  const rr = beats.slice(-11).map((b, i, a) => (i ? b - a[i - 1] : null)).filter((v) => v !== null)
  const hr = rr.length >= 3 ? Math.round(60000 / median(rr)) : '—'
  setStatus(
    (finger ? '<span class="ok">Палец на месте</span>' : '<span class="warn">Закройте пальцем камеру и вспышку</span>') +
      '<br>Пульс: ' + hr + ' · осталось ' + left + ' с'
  )

  if (elapsed >= durationMs) finish()
  else video.requestVideoFrameCallback((n, m) => onFrame(n, m, id))
}

function summary() {
  const gaps = frameTimes.slice(1).map((t, i) => t - frameTimes[i])
  const dur = (frameTimes[frameTimes.length - 1] - frameTimes[0]) / 1000
  const fps = (frameTimes.length - 1) / dur
  const gap = meanSd(gaps)
  const drops = gaps.filter((g) => g > PROBE.DROP_GAP_MS).length
  const rr = beats.slice(1).map((b, i) => b - beats[i])
  const rrStat = meanSd(rr)
  const fingerShare = fingerFrames / frameTimes.length
  const ok = info.torch && fps >= PROBE.GOOD_FPS && fingerShare >= PROBE.GOOD_FINGER_SHARE && rr.length >= 30
  const lines = [
    'ВЫВОД: ' + (ok ? 'ТЕЛЕФОН ПОДХОДИТ' : 'ЕСТЬ ПРОБЛЕМЫ — см. ниже'),
    '',
    'Камера: ' + info.camera,
    'Вспышка: ' + (info.torch ? 'включилась' : info.torchSupported ? 'не включилась' : 'не поддерживается этой камерой'),
    'Разрешение: ' + info.resolution + ', частота по настройке ' + info.frameRateSetting + ', максимум ' + info.frameRateMax,
    'Кадров в секунду фактически: ' + fps.toFixed(1),
    'Промежуток между кадрами: ср ' + gap.mean.toFixed(1) + ' мс, разброс ' + gap.sd.toFixed(1) + ' мс',
    'Потерянных кадров (промежуток > ' + PROBE.DROP_GAP_MS + ' мс): ' + drops,
    'Источник времени кадра: ' + timeSource,
    'Палец лежал правильно: ' + Math.round(fingerShare * 100) + '% времени',
    'Найдено ударов: ' + beats.length,
    'Интервал между ударами: ср ' + rrStat.mean.toFixed(0) + ' мс, разброс ' + rrStat.sd.toFixed(0) + ' мс',
    'Пульс по интервалам: ' + (rr.length ? Math.round(60000 / median(rr)) : '—'),
    '',
    'Браузер: ' + navigator.userAgent,
  ]
  if (!info.torch) lines.push('', '→ Вспышка не включилась: выберите в списке другую камеру и повторите.')
  if (fps < PROBE.GOOD_FPS) lines.push('', '→ Мало кадров в секунду: закройте другие приложения и повторите.')
  if (fingerShare < PROBE.GOOD_FINGER_SHARE) lines.push('', '→ Палец часто сползал: держите руку неподвижно, палец лёгким касанием.')
  return lines.join('\n')
}

function finish() {
  running = false
  if (track) {
    track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {})
  }
  if (stream) stream.getTracks().forEach((t) => t.stop())
  if (wakeLock) wakeLock.release().catch(() => {})
  $('stats').textContent = summary()
  // Файл записи: сырой сигнал и сведения о камере — для разбора на сервере
  const data = { version: 1, recordedAt: new Date().toISOString(), durationMs, info, userAgent: navigator.userAgent, columns: ['t_ms', 'red', 'green'], frames: raw }
  const name = 'pulse-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json'
  recordFile = new File([JSON.stringify(data)], name, { type: 'application/json' })
  $('save').hidden = false
  setStatus('Готово. Сделайте скриншот результата ниже.')
  $('start').disabled = false
  $('record').disabled = false
  if (navigator.vibrate) navigator.vibrate(300)
}

async function start(deviceId, ms = PROBE.DURATION_MS) {
  durationMs = ms
  $('start').disabled = true
  $('record').disabled = true
  $('save').hidden = true
  $('stats').textContent = ''
  try {
    const id = await openCamera(deviceId)
    await listCameras(id)
  } catch (e) {
    setStatus('<span class="bad">Камера не открылась: ' + e.name + '</span><br>Разрешите доступ к камере в настройках сайта.')
    $('start').disabled = false
    $('record').disabled = false
    return
  }
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    setStatus('<span class="bad">Браузер не поддерживает покадровую обработку. Откройте страницу в Chrome.</span>')
    $('start').disabled = false
    $('record').disabled = false
    return
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen')
  } catch (e) {
    wakeLock = null
  }
  detector = new BeatDetector()
  frameTimes = []
  fingerFrames = 0
  beats = []
  raw = []
  running = true
  startedAt = performance.now()
  const id = ++session
  video.requestVideoFrameCallback((n, m) => onFrame(n, m, id))
}

const chosenCamera = () => ($('camera').disabled ? null : $('camera').value)
$('start').addEventListener('click', () => start(chosenCamera(), PROBE.DURATION_MS))
$('record').addEventListener('click', () => start(chosenCamera(), PROBE.RECORD_MS))
$('camera').addEventListener('change', () => {
  running = false
  start($('camera').value, durationMs)
})

// Отправить файл через меню «Поделиться» Android (Google Диск, почта, мессенджеры)
$('share').addEventListener('click', async () => {
  if (!recordFile) return
  if (navigator.canShare && navigator.canShare({ files: [recordFile] })) {
    try {
      await navigator.share({ files: [recordFile], title: recordFile.name })
    } catch (e) {
      // пользователь закрыл меню — ничего не делаем
    }
  } else {
    alert('Телефон не умеет отправлять файл отсюда — нажмите «Скачать файл записи».')
  }
})

// Скачать файл в «Загрузки»
$('download').addEventListener('click', () => {
  if (!recordFile) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(recordFile)
  a.download = recordFile.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
})
