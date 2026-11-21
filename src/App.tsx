import { useCallback, useEffect, useRef, useState } from 'react'
import type { Config, OptimizeResult, Point, PowerResult } from './types'
import { getConfig, optimize, simulate } from './api'
import { createWindScene } from './scene'
import type { ReturnTypeScene } from './scene-typing'

const fmt = (n: number, digits = 1) => n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const copyLayout = (ps: Point[]) => ps.map(p => ({ ...p }))
const withDirection = (n: number) => n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : `${n}°`

export default function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [layout, setLayout] = useState<Point[]>([])
  const [metrics, setMetrics] = useState<PowerResult | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [windSpeed, setWindSpeed] = useState(8)
  const [windDirection, setWindDirection] = useState(270)
  const [status, setStatus] = useState<'loading' | 'ready' | 'computing' | 'optimizing' | 'error'>('loading')
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [before, setBefore] = useState<Point[] | null>(null)
  const [optimized, setOptimized] = useState<Point[] | null>(null)
  const [isAfter, setIsAfter] = useState(false)
  const [showWakes, setShowWakes] = useState(true)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<ReturnTypeScene | null>(null)
  const layoutRef = useRef<Point[]>([])
  const configRef = useRef<Config | null>(null)
  const requestId = useRef(0)
  const dragRef = useRef(false)
  const optimizingRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)

  const applyLayout = useCallback((points: Point[], clearCompare = false) => {
    const next = copyLayout(points)
    layoutRef.current = next
    sceneRef.current?.setLayout(next)
    setLayout(next)
    if (clearCompare) { setResult(null); setBefore(null); setOptimized(null); setIsAfter(false) }
  }, [])

  useEffect(() => {
    let active = true
    getConfig().then(settings => {
      if (!active) return
      configRef.current = settings
      setConfig(settings)
      applyLayout(settings.initial_layout)
      setWindSpeed(settings.default_wind.speed)
      setWindDirection(settings.default_wind.direction)
    }).catch(err => {
      if (!active) return
      setError(err.message); setStatus('error')
    })
    return () => { active = false }
  }, [applyLayout])

  useEffect(() => {
    if (!config || !containerRef.current) return
    const scene = createWindScene(containerRef.current, config, {
      onSelect(index) { setSelected(index) },
      onMoveStart() { dragRef.current = true; setHint('Drag to reposition · release to recalculate') },
      onMove(index, candidate) {
        const settings = configRef.current
        if (!settings) return false
        const { width_m, height_m, min_spacing_m } = settings.site
        const other = layoutRef.current
        const valid = candidate.x >= 0 && candidate.x <= width_m && candidate.y >= 0 && candidate.y <= height_m &&
          other.every((p, i) => i === index || Math.hypot(p.x - candidate.x, p.y - candidate.y) >= min_spacing_m)
        setHint(valid ? 'Release to calculate new wake losses' : 'Placement invalid · 504 m minimum spacing')
        if (valid) { layoutRef.current[index] = candidate }
        return valid
      },
      onMoveEnd() { dragRef.current = false; setHint(''); applyLayout(layoutRef.current, true) },
    })
    sceneRef.current = scene
    scene.setMetrics(metrics)
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
      scene.destroy(); sceneRef.current = null
    }
  // Keep scene alive across metrics or wind changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, applyLayout])

  useEffect(() => { sceneRef.current?.setMetrics(metrics) }, [metrics])
  useEffect(() => { sceneRef.current?.setWind(windDirection, windSpeed) }, [windDirection, windSpeed])
  useEffect(() => { sceneRef.current?.setSelected(selected) }, [selected])
  useEffect(() => { sceneRef.current?.setWakesVisible(showWakes) }, [showWakes])
  useEffect(() => {
    if (!config || !layout.length || dragRef.current || optimizingRef.current) return
    const id = ++requestId.current
    const controller = new AbortController()
    setStatus('computing'); setError('')
    const timer = window.setTimeout(() => {
      simulate(layout, windSpeed, windDirection, controller.signal).then(data => {
        if (requestId.current !== id) return
        setMetrics(data); setStatus('ready')
      }).catch(err => {
        if (requestId.current !== id || err.name === 'AbortError') return
        setError(err.message); setStatus('error')
      })
    }, 170)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [config, layout, windSpeed, windDirection])

  const animateTo = (target: Point[], onFinished?: () => void) => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    const start = copyLayout(layoutRef.current)
    const began = performance.now()
    const duration = 1450
    const frame = (now: number) => {
      const t = Math.min(1, (now - began) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      sceneRef.current?.setLayout(start.map((p, i) => ({
        x: p.x + (target[i].x - p.x) * eased,
        y: p.y + (target[i].y - p.y) * eased,
      })))
      if (t < 1) animationFrameRef.current = requestAnimationFrame(frame)
      else { animationFrameRef.current = null; onFinished?.(); applyLayout(target) }
    }
    animationFrameRef.current = requestAnimationFrame(frame)
  }

  const runOptimize = async () => {
    if (optimizingRef.current || !layout.length) return
    optimizingRef.current = true
    requestId.current += 1 // Ignore stale live-simulation responses during optimization
    setStatus('optimizing'); setError(''); setHint('Solving constrained layout optimization…')
    const original = copyLayout(layoutRef.current)
    try {
      const value = await optimize(original, windSpeed, windDirection)
      setHint('')
      setResult(value)
      if (!value.accepted) { optimizingRef.current = false; setStatus('ready'); setHint(value.message); return }
      setBefore(original); setOptimized(copyLayout(value.layout))
      setIsAfter(true)
      animateTo(value.layout, () => { optimizingRef.current = false; setStatus('ready') })
    } catch (err) {
      optimizingRef.current = false; setError((err as Error).message); setHint(''); setStatus('error')
    }
  }

  const viewLayout = (after: boolean) => {
    if (optimizingRef.current || !before || !optimized) return
    setIsAfter(after)
    animateTo(after ? optimized : before)
  }
  const reset = () => {
    if (!config || optimizingRef.current) return
    if (animationFrameRef.current !== null) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }
    applyLayout(config.initial_layout, true)
    setHint('Original six-turbine scenario restored')
  }

  return <main className="app">
    <div className="scene" ref={containerRef} aria-label="Interactive Cesium 3D wind farm" />
    <div className="topbar">
      <div className="brand"><span className="brand-icon">◈</span><div><b>windlab<span className="brand-dot">.</span></b><small>FARM DESIGN STUDIO</small></div></div>
      <div className="top-center"><span className="active-pulse" /> SCENARIO 01 <span className="bar-sep">/</span> NORTHERN MAINE · CONCEPTUAL <span className="bar-sep">/</span> 6 × NREL 5MW</div>
      <button className="quiet-btn" type="button" onClick={() => sceneRef.current?.flyHome()}>↗ &nbsp; Reset view</button>
    </div>
    <aside className="left-panel">
      <div className="eyebrow"><span className="kicker-dot"/> WIND FARM INTELLIGENCE</div>
      <h1>Design for <em>the wind.</em></h1>
      <p className="intro">Explore how turbine placement shapes airflow, wake interference, and annual energy production.</p>
      <div className="section-rule"/>
      <div className="panel-title-row"><h2>Wind conditions</h2><span className="tiny-pill">LIVE MODEL</span></div>
      <div className="control">
        <div className="control-head"><label htmlFor="speed">Wind speed</label><strong>{fmt(windSpeed)} <small>m/s</small></strong></div>
        <input id="speed" type="range" min="2" max="20" step="0.5" value={windSpeed} onChange={e => setWindSpeed(Number(e.target.value))}/>
        <div className="scale"><span>2</span><span>11</span><span>20</span></div>
      </div>
      <div className="control">
        <div className="control-head"><label htmlFor="direction">Wind direction <span className="help" title="Meteorological direction: the direction wind originates from">ⓘ</span></label><strong>{windDirection}° <small>{withDirection(windDirection)}</small></strong></div>
        <input id="direction" type="range" min="0" max="359" step="1" value={windDirection} onChange={e => setWindDirection(Number(e.target.value))}/>
        <div className="scale"><span>N · 0°</span><span>S · 180°</span><span>N · 360°</span></div>
      </div>
      <div className="section-rule"/>
      <div className="panel-title-row"><h2>Farm performance</h2><span className="tiny-pill gray">SIMULATED</span></div>
      <div className="metric-primary"><div><span>POWER OUTPUT</span><strong>{metrics ? fmt(metrics.power_mw, 2) : '—'}<small> MW</small></strong></div><div className="metric-mark">↗</div></div>
      <div className="metric-grid">
        <div className="mini-metric"><span>ANNUAL ENERGY</span><strong>{metrics ? fmt(metrics.aep_mwh, 0) : '—'} <small>MWh</small></strong></div>
        <div className="mini-metric"><span>ANNUAL WAKE LOSS</span><strong>{metrics ? fmt(metrics.annual_wake_loss_pct) : '—'} <small>%</small></strong></div>
      </div>
      <p className="metric-note">Annual estimates use the fixed wind distribution, not the selected live wind conditions.</p>
      <div className="section-rule"/>
      <button className="optimize" onClick={runOptimize} disabled={!config || status === 'optimizing' || status === 'loading'}>
        <span className="opt-icon">✳</span><span>{status === 'optimizing' ? 'Optimizing layout…' : 'Optimize turbine layout'}</span><span className="opt-arr">↗</span>
      </button>
      <button className="reset-layout" onClick={reset} type="button">↶ &nbsp; Restore initial layout</button>
      {error && <div role="alert" className="error"><b>Simulation unavailable</b><p>{error}</p><small>Run the FLORIS backend. No figures are estimated without it.</small></div>}
      {hint && !error && <div className="hint">{hint}</div>}
    </aside>
    <div className="viewport-label"><span className="crosshair">＋</span><span>3D SITE VIEW <em>·</em> 2.4 × 1.8 KM</span></div>
    <div className="right-panel">
      <div className="view-title">THE FARM <span>↗</span></div>
      <div className="right-row"><span>Wind turbines</span><strong>06</strong></div>
      <div className="right-row"><span>Installed capacity</span><strong>30 MW</strong></div>
      <div className="right-row"><span>Minimum spacing</span><strong>{config ? config.site.min_spacing_m : '—'} m</strong></div>
      <div className="right-row"><span>Wake envelopes</span><button type="button" className="switch" aria-pressed={showWakes} onClick={() => setShowWakes(p => !p)}>{showWakes ? 'ON' : 'OFF'}</button></div>
      <div className="right-rule"/>
      {selected !== null && metrics?.turbines[selected] ? <div className="selected-card">
        <span className="tiny-label">SELECTED UNIT</span><h3>TURBINE {String(selected + 1).padStart(2, '0')}</h3>
        <div className="right-row"><span>Instantaneous power</span><strong>{fmt(metrics.turbines[selected].power_mw, 2)} MW</strong></div>
        <div className="right-row"><span>Wake penalty</span><strong>{fmt(metrics.turbines[selected].wake_loss_pct)}%</strong></div>
        <p>Drag this turbine to update its position. Min. 504 m clearance.</p>
      </div> : <div className="selected-card"><span className="tiny-label">INTERACTIVE SCENE</span><h3>Select a turbine</h3><p>Click a turbine to inspect its power, or drag it to explore a new arrangement.</p></div>}
    </div>
    {result?.accepted && before && optimized && <div className="compare-panel">
      <div><span className="tiny-label">LAYOUT OPTIMIZATION COMPLETE</span><div className="gain">+{fmt(result.improvement_pct, 2)}% <small>estimated AEP</small></div><p>{fmt(result.baseline.aep_mwh, 0)} → {fmt(result.optimized.aep_mwh, 0)} MWh / year</p></div>
      <div className="compare-actions"><button className={!isAfter ? 'active' : ''} onClick={() => viewLayout(false)}>Before</button><button className={isAfter ? 'active' : ''} onClick={() => viewLayout(true)}>After</button></div>
    </div>}
    <footer className="foot"><div className="source"><span className="source-dot" /> {config?.wind_resource.is_historical ? 'ERA5 HISTORICAL RESOURCE' : 'ILLUSTRATIVE WIND RESOURCE'} &nbsp;·&nbsp; JENSEN / FLORIS</div><div className="foot-right"><span className={`badge-status ${status}`}>{status === 'ready' ? '● MODEL READY' : status === 'error' ? '● OFFLINE' : '◌ CALCULATING'}</span><button type="button" onClick={() => setHint(config?.wind_resource.notice ?? 'Fictional site, steady-state wake physics; preliminary estimates only')}>ⓘ Assumptions</button></div></footer>
  </main>
}
