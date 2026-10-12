// Камера со вспышкой и покадровая яркость. Работает только в браузере (Chrome на Android).

export const CAMERA = {
  SAMPLE_W: 32, // кадр уменьшаем до 32×24 — для средней яркости достаточно
  SAMPLE_H: 24,
  FINGER_MIN_RED: 100, // палец на камере со вспышкой: красный яркий…
  FINGER_RED_TO_GREEN: 1.8, // …и намного ярче зелёного
}

/**
 * Запись кадров с задней камеры. onFrame получает {t, r, g, finger} для каждого кадра.
 */
export class CameraRecorder {
  constructor(video, cfg = CAMERA) {
    this.video = video
    this.cfg = cfg
    this.stream = null
    this.track = null
    this.session = 0
    this.info = {}
    this.canvas = document.createElement('canvas')
    this.canvas.width = cfg.SAMPLE_W
    this.canvas.height = cfg.SAMPLE_H
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && 'requestVideoFrameCallback' in HTMLVideoElement.prototype)
  }

  async cameras() {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((d) => d.kind === 'videoinput')
  }

  /**
   * Открыть камеру, включить вспышку и начать отдавать кадры.
   * @returns {Promise<object>} сведения о камере (torch — включилась ли вспышка)
   */
  async start(onFrame, deviceId = null) {
    this.stop()
    const base = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
    const video = deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: 'environment' } }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video })
    this.track = this.stream.getVideoTracks()[0]
    this.video.srcObject = this.stream
    await this.video.play()

    const caps = this.track.getCapabilities ? this.track.getCapabilities() : {}
    const settings = this.track.getSettings()
    let torch = false
    if (caps.torch) {
      try {
        await this.track.applyConstraints({ advanced: [{ torch: true }] })
        torch = true
      } catch (e) {
        torch = false
      }
    }
    this.info = { camera: this.track.label, deviceId: settings.deviceId, torch, resolution: settings.width + '×' + settings.height }

    const id = ++this.session
    const loop = (now, meta) => {
      if (id !== this.session) return
      const t = meta && meta.captureTime ? meta.captureTime : meta && meta.mediaTime ? meta.mediaTime * 1000 : now
      this.ctx.drawImage(this.video, 0, 0, this.cfg.SAMPLE_W, this.cfg.SAMPLE_H)
      const px = this.ctx.getImageData(0, 0, this.cfg.SAMPLE_W, this.cfg.SAMPLE_H).data
      let r = 0
      let g = 0
      for (let i = 0; i < px.length; i += 4) {
        r += px[i]
        g += px[i + 1]
      }
      const n = px.length / 4
      r /= n
      g /= n
      const finger = r >= this.cfg.FINGER_MIN_RED && r >= this.cfg.FINGER_RED_TO_GREEN * g
      onFrame({ t, r, g, finger })
      this.video.requestVideoFrameCallback(loop)
    }
    this.video.requestVideoFrameCallback(loop)
    return this.info
  }

  stop() {
    this.session++
    if (this.track) this.track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {})
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.track = null
  }
}
