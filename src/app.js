import * as ecs from '@8thwall/ecs'
import QRCode from 'qrcode'
import scene from './.expanse.json'

// 1. Monitoreo de señales de preparación del motor XR8
let resolveRealityReady
const realityReadyPromise = new Promise((resolve) => {
  resolveRealityReady = resolve
})

let resolveImageScanning
const imageScanningPromise = new Promise((resolve) => {
  resolveImageScanning = resolve
})

// Configuración de XR8 (15 Imagen Targets de Mechas) y módulo de pipeline para eventos AR
const onxrloaded = () => {
  XR8.XrController.configure({
    imageTargetData: [
      require('../image-targets/AGUSTIN_SADRAN_MECHATANA-MECHA_diseno_V3_nombre.json'),
      require('../image-targets/CASOLATI_CAMILA_LUMA_diseno_V1_nombre.json'),
      require('../image-targets/E6-K22B_BrucoliRoman_Render_diseno_V1_nombre.json'),
      require('../image-targets/FACUNDO_PIPUTTO_MECHA_diseno_V2_nombre.json'),
      require('../image-targets/FEDERICO_PRACIAS-RoboCOR_diseno_V3_nombre.json'),
      require('../image-targets/FRANCISCO_RIZZO_MECHA_diseno_V1_nombre.json'),
      require('../image-targets/LUCA_VIOLI_MECHATANA-MECHA_diseno_V2_nombre.json'),
      require('../image-targets/MAITE_RODRIGUEZ_NUR53-MECHA_diseno_V2_nombre.json'),
      require('../image-targets/MELODY_RAMOS_MECHA_diseno_V4_nombre.json'),
      require('../image-targets/PEDRO_MAMCIZ_ALIEN-MECHA_diseno_V1_nombre.json'),
      require('../image-targets/Roque_Casarella-MECHA_diseno_v1_nombre.json'),
      require('../image-targets/SILVA_FRANCISCO_DISENO_V1_nombre.json'),
      require('../image-targets/SILVA_IRINA_MECHA.diseno_V4_nombre.json'),
      require('../image-targets/SOFIA_CRAVERO_MANDIBULA VERDE-MECH_diseno_V2_nombre.json'),
      require('../image-targets/Virna_Vianello MECHA_diseño_V2_nombre.json'),
    ],
  })

  // Módulo de pipeline para detectar cuándo XR8 está listo y escaneando imágenes
  XR8.addCameraPipelineModule({
    name: 'mechas-tracking-monitor',
    listeners: [
      {
        event: 'realityready',
        process: () => {
          console.log('[Mechas AR] realityready recibido de XR8')
          resolveRealityReady()
        },
      },
      {
        event: 'reality.imagescanning',
        process: (detail) => {
          console.log('[Mechas AR] reality.imagescanning recibido de XR8:', detail)
          resolveImageScanning()
        },
      },
    ],
  })
}
window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)

// Listeners adicionales globales en window por respaldo
window.addEventListener('realityready', () => resolveRealityReady())
window.addEventListener('reality.imagescanning', () => resolveImageScanning())

// 2. Extraer dinámicamente los modelos GLB declarados en la escena .expanse.json
const getSceneModelUrls = () => {
  const urls = new Set()
  if (scene && scene.objects) {
    for (const id in scene.objects) {
      const obj = scene.objects[id]
      if (obj.gltfModel?.src?.asset) {
        const cleanPath = obj.gltfModel.src.asset.startsWith('/')
          ? obj.gltfModel.src.asset.slice(1)
          : obj.gltfModel.src.asset
        urls.add('./' + cleanPath)
      }
    }
  }
  return Array.from(urls)
}

// 3. Monitorear ecs.events.GLTF_MODEL_LOADED para asegurar que los 21 modelos sean parseados
let parsedModelsCount = 0
const parsedEntityIds = new Set()
let onModelParsedCallback = null

let listenerAttached = false
let ecsWorldRef = null
ecs.registerBehavior((world) => {
  ecsWorldRef = world
  if (!listenerAttached) {
    listenerAttached = true

    // Detección por si ECS propaga eventos de Realidad
    world.events.addListener(world.events.globalId, ecs.events.REALITY_READY, () => {
      console.log('[Mechas AR] ECS REALITY_READY recibido')
      resolveRealityReady()
    })
    world.events.addListener(world.events.globalId, ecs.events.REALITY_IMAGE_SCANNING, (detail) => {
      console.log('[Mechas AR] ECS REALITY_IMAGE_SCANNING recibido:', detail)
      resolveImageScanning()
    })

    // Contar cada modelo que termina de parsearse en escena
    world.events.addListener(world.events.globalId, ecs.events.GLTF_MODEL_LOADED, (event) => {
      const targetId = event.target || (event.model && event.model.uuid) || (`model_${parsedModelsCount}`)
      if (!parsedEntityIds.has(targetId)) {
        parsedEntityIds.add(targetId)
        parsedModelsCount++
        console.log(`[Mechas AR] GLTF_MODEL_LOADED detectado en escena (${parsedModelsCount})`)
        if (onModelParsedCallback) {
          onModelParsedCallback(parsedModelsCount)
        }
      }
    })
  }

  // Verificación adicional de respaldo por si algunos modelos ya fueron instanciados antes de registrar el behavior
  if (world.three?.entityToObject) {
    for (const [eid, obj] of world.three.entityToObject.entries()) {
      if (obj.userData?.gltf && !parsedEntityIds.has(eid)) {
        parsedEntityIds.add(eid)
        parsedModelsCount++
        if (onModelParsedCallback) {
          onModelParsedCallback(parsedModelsCount)
        }
      }
    }
  }
})

// Esperar que todos los modelos se hayan parseado con timeout de seguridad (15s)
function waitForAllEcsModels(totalModels, onProgress, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (parsedModelsCount >= totalModels) {
      if (onProgress) onProgress(parsedModelsCount, totalModels)
      return resolve()
    }

    let resolved = false
    const finish = () => {
      if (!resolved) {
        resolved = true
        resolve()
      }
    }

    const timer = setTimeout(() => {
      console.warn(`[Mechas AR] Timeout esperando parseo ECS (${parsedModelsCount}/${totalModels}). Continuando...`)
      finish()
    }, timeoutMs)

    onModelParsedCallback = (current) => {
      if (onProgress) onProgress(current, totalModels)
      if (current >= totalModels) {
        clearTimeout(timer)
        finish()
      }
    }
  })
}

// Funciones para esperar confirmación de XR8 con timeout prudencial (10s)
function waitForRealityReady(timeoutMs = 10000) {
  return Promise.race([
    realityReadyPromise,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

function waitForImageScanning(timeoutMs = 10000) {
  return Promise.race([
    imageScanningPromise,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

// 4. Descarga de archivos con seguimiento de modelos descargados (X de 21) y progreso
async function preloadAsset(url, onChunk, onComplete) {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentLength = response.headers.get('content-length')
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0

    if (!response.body || !totalBytes) {
      await response.blob()
      if (onChunk) onChunk(1)
      if (onComplete) onComplete()
      return
    }

    const reader = response.body.getReader()
    let loaded = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      loaded += value.length
      if (onChunk) onChunk(loaded / totalBytes)
    }
    if (onComplete) onComplete()
  } catch (err) {
    console.warn('[Mechas AR] Error precargando asset:', url, err)
    if (onChunk) onChunk(1)
    if (onComplete) onComplete()
  }
}

async function preloadAllAssets(urls, onProgress) {
  const total = urls.length
  if (!total) {
    if (onProgress) onProgress({ completed: 0, total: 0, ratio: 1 })
    return
  }

  let completed = 0
  const progresses = new Array(total).fill(0)

  const notify = () => {
    const sum = progresses.reduce((a, b) => a + b, 0)
    const ratio = sum / total
    if (onProgress) {
      onProgress({ completed, total, ratio })
    }
  }

  await Promise.all(
    urls.map((url, i) =>
      preloadAsset(
        url,
        (modelRatio) => {
          progresses[i] = modelRatio
          notify()
        },
        () => {
          completed++
          progresses[i] = 1
          notify()
        }
      )
    )
  )
}

// 5. Detección de dispositivo móvil vs desktop
const isMobileDevice = () => {
  const hasTouch = navigator.maxTouchPoints > 0
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  const isIPad = /Macintosh/i.test(navigator.userAgent) && hasTouch
  return isMobileUA || isIPad
}

// 6. Flujo de carga para móvil (Descarga -> Parseo ECS -> Listo XR8)
async function startMobileFlow() {
  const loaderEl = document.getElementById('custom-loader')
  const statusEl = document.getElementById('loader-status')
  const stageEl = document.getElementById('progress-stage')
  const fillEl = document.getElementById('progress-fill')
  const percentEl = document.getElementById('progress-percent')
  const progressBox = document.getElementById('progress-box')
  const startBtn = document.getElementById('start-btn')

  const setProgress = (val, stage, status) => {
    if (fillEl) fillEl.style.width = `${val}%`
    if (percentEl) percentEl.textContent = `${val}%`
    if (stageEl && stage) stageEl.textContent = stage
    if (statusEl && status) statusEl.textContent = status
  }

  const urls = getSceneModelUrls()
  const totalModels = urls.length

  // FASE 1: DESCARGA DE RECURSOS POR RED (0% a 70%)
  setProgress(0, 'Iniciando descarga', `Conectando con el servidor (${totalModels} mechas)...`)

  let lastPct = 0
  await preloadAllAssets(urls, ({ completed, total, ratio }) => {
    const pct = Math.min(70, Math.floor(ratio * 70))
    if (pct !== lastPct) {
      lastPct = pct
      setProgress(
        pct,
        'Descargando mechas...',
        `${completed} de ${total} modelos cargados (${pct}%)`
      )
    }
  })

  // Al finalizar la descarga de bytes, fijar en 70%
  setProgress(70, 'Compilando modelos 3D...', `${totalModels} de ${totalModels} modelos descargados (70%)`)

  // FASE 2: ESPERAR PARSEO DE LOS 21 MODELOS EN ECS (70% a 88%)
  await waitForAllEcsModels(totalModels, (current, total) => {
    const progressRange = 18 // de 70% a 88%
    const currentPct = 70 + Math.floor((current / total) * progressRange)
    setProgress(
      currentPct,
      'Compilando modelos 3D...',
      `Compilando mechas en escena (${current} de ${total})...`
    )
  })

  // FASE 3: ESPERAR CONFIRMACIÓN DE XR8 (88% a 100%)
  setProgress(88, 'Iniciando Realidad Aumentada...', 'Conectando motor AR (XR8)...')

  // Esperar realityready
  await waitForRealityReady(10000)
  setProgress(94, 'Iniciando Realidad Aumentada...', `Calibrando ${totalModels} targets de imagen...`)

  // Esperar reality.imagescanning
  await waitForImageScanning(10000)

  // Suave transición a 100%
  for (let p = 95; p <= 100; p++) {
    setProgress(p, '¡Sistema listo!', `${totalModels} mechas listos para escanear`)
    await new Promise((r) => setTimeout(r, 20))
  }

  // FASE 4: TRANSICIÓN A BOTÓN "COMENZAR BÚSQUEDA"
  if (statusEl) statusEl.textContent = `${totalModels} mechas listos para escanear`
  if (progressBox) {
    progressBox.style.opacity = '0'
    setTimeout(() => {
      progressBox.style.display = 'none'
      if (startBtn) {
        startBtn.style.display = 'inline-flex'
      }
    }, 300)
  }

  // FASE 5: INICIAR EXPERIENCIA TRAS EL GESTO DEL USUARIO
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (loaderEl) {
        loaderEl.classList.add('loader-hidden')
        setTimeout(() => {
          loaderEl.style.display = 'none'
        }, 600)
      }
    })
  }
}

// 7. Flujo para Desktop: Mostrar Código QR
async function startDesktopFlow() {
  const mobileView = document.getElementById('mobile-view')
  const desktopView = document.getElementById('desktop-view')
  const qrImage = document.getElementById('qr-image')
  const bypassBtn = document.getElementById('desktop-bypass-btn')

  if (mobileView) mobileView.style.display = 'none'
  if (desktopView) desktopView.style.display = 'flex'

  // Generar el código QR con la URL actual del proyecto
  try {
    const currentUrl = window.location.href
    const qrDataUrl = await QRCode.toDataURL(currentUrl, {
      width: 240,
      margin: 1,
      color: {
        dark: '#0a101f',
        light: '#ffffff',
      },
    })
    if (qrImage) {
      qrImage.src = qrDataUrl
    }
  } catch (err) {
    console.error('[Mechas AR] Error generando código QR:', err)
  }

  // Permitir al usuario/desarrollador probar en la PC si lo desea
  if (bypassBtn) {
    bypassBtn.addEventListener('click', () => {
      if (desktopView) desktopView.style.display = 'none'
      if (mobileView) mobileView.style.display = 'flex'
      startMobileFlow()
    })
  }
}

// 8. Inicialización general
function initLoader() {
  const isForced = window.location.search.includes('force=1')
  if (isMobileDevice() || isForced) {
    startMobileFlow()
  } else {
    startDesktopFlow()
  }
}

// 9. HUD de Diagnóstico en Tiempo Real (MB descargados, Texturas VRAM, Geometrías, FPS y Memoria)
function initDebugHUD() {
  const totalModels = getSceneModelUrls().length
  const hud = document.createElement('div')
  hud.id = 'debug-hud'
  hud.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(10, 15, 25, 0.85);
    color: #00f0ff;
    font-family: monospace, -apple-system, sans-serif;
    font-size: 11px;
    line-height: 1.4;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(0, 240, 255, 0.4);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6);
    z-index: 1000000;
    pointer-events: none;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    min-width: 170px;
  `
  hud.innerHTML = `
    <div style="font-weight: bold; color: #fff; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 2px;">
      DIAGNÓSTICO AR
    </div>
    <div>FPS: <span id="hud-fps" style="color: #4ade80;">--</span></div>
    <div>Descarga: <span id="hud-net" style="color: #facc15;">0 MB</span></div>
    <div>Modelos GLB: <span id="hud-glb" style="color: #fff;">0 / ${totalModels}</span></div>
    <div>Texturas VRAM: <span id="hud-tex" style="color: #38bdf8;">0</span></div>
    <div>Geometrías: <span id="hud-geo" style="color: #38bdf8;">0</span></div>
    <div>Memoria JS: <span id="hud-mem" style="color: #f472b6;">N/A</span></div>
  `
  document.body.appendChild(hud)

  const elFps = document.getElementById('hud-fps')
  const elNet = document.getElementById('hud-net')
  const elGlb = document.getElementById('hud-glb')
  const elTex = document.getElementById('hud-tex')
  const elGeo = document.getElementById('hud-geo')
  const elMem = document.getElementById('hud-mem')

  // Contador de FPS
  let frames = 0
  let lastFpsTime = performance.now()
  function calculateFps(now) {
    frames++
    if (now - lastFpsTime >= 1000) {
      const fps = Math.round((frames * 1000) / (now - lastFpsTime))
      if (elFps) {
        elFps.textContent = fps
        elFps.style.color = fps < 25 ? '#ef4444' : fps < 45 ? '#facc15' : '#4ade80'
      }
      frames = 0
      lastFpsTime = now
    }
    requestAnimationFrame(calculateFps)
  }
  requestAnimationFrame(calculateFps)

  // Actualizador de métricas de red y memoria WebGL
  setInterval(() => {
    // 1. Megabytes descargados reales
    try {
      const resources = performance.getEntriesByType('resource')
      let totalBytes = 0
      for (let i = 0; i < resources.length; i++) {
        const r = resources[i]
        // Se toma transferSize o decodedBodySize según disponibilidad
        totalBytes += r.transferSize || r.decodedBodySize || 0
      }
      const mb = (totalBytes / (1024 * 1024)).toFixed(1)
      if (elNet) elNet.textContent = `${mb} MB`
    } catch (_) {}

    // 2. Modelos parseados en escena
    if (elGlb) {
      elGlb.textContent = `${parsedModelsCount} / ${totalModels}`
    }

    // 3. Texturas y Geometrías en VRAM (Three.js WebGLRenderer)
    try {
      const renderer = ecsWorldRef?.three?.renderer || window.THREE?.renderer
      if (renderer?.info?.memory) {
        if (elTex) elTex.textContent = renderer.info.memory.textures || 0
        if (elGeo) elGeo.textContent = renderer.info.memory.geometries || 0
      }
    } catch (_) {}

    // 4. Memoria JS Heap (si el navegador lo soporta, ej: Chrome / Chromium)
    if (performance.memory && elMem) {
      const jsMb = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024))
      elMem.textContent = `${jsMb} MB`
    }
  }, 500)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initLoader()
    initDebugHUD()
  })
} else {
  initLoader()
  initDebugHUD()
}

