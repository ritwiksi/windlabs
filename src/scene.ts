import {
  Cartesian2, Cartesian3, Color, CallbackProperty, CallbackPositionProperty, CylinderGraphics, EllipseGraphics,
  Entity, HeadingPitchRange, Math as CMath, Matrix3, Matrix4, PolygonHierarchy,
  Quaternion, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms, Viewer, ClockRange,
  Cartographic, ConstantProperty, BoundingSphere, ColorMaterialProperty,
} from 'cesium'
import type { Config, Point, PowerResult } from './types'

const CENTER_LON = -67.87
const CENTER_LAT = 46.52
const LAT_M = 111_320
const LON_M = LAT_M * Math.cos(CENTER_LAT * Math.PI / 180)
const c = (hex: string, alpha = 1) => Color.fromCssColorString(hex).withAlpha(alpha)

export function localToWorld(x: number, y: number, h = 0): Cartesian3 {
  return Cartesian3.fromDegrees(CENTER_LON + (x - 1200) / LON_M, CENTER_LAT + (y - 900) / LAT_M, h)
}
export function worldToLocal(point: Cartesian3): Point {
  const p = Cartographic.fromCartesian(point)
  if (!p) return { x: 1200, y: 900 }
  return { x: (CMath.toDegrees(p.longitude) - CENTER_LON) * LON_M + 1200,
    y: (CMath.toDegrees(p.latitude) - CENTER_LAT) * LAT_M + 900 }
}


type SceneBridge = {
  setLayout: (layout: Point[]) => void
  setMetrics: (metrics: PowerResult | null) => void
  setWind: (direction: number, speed: number) => void
  setWakesVisible: (visible: boolean) => void
  setSelected: (index: number | null) => void
  flyHome: () => void
  destroy: () => void
}

const blend = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

export function createWindScene(
  element: HTMLElement,
  initial: Config,
  hooks: {
    onSelect: (index: number | null) => void
    onMoveStart: () => void
    onMove: (index: number, candidate: Point) => boolean
    onMoveEnd: (index: number) => void
  },
): SceneBridge {
  const viewer = new Viewer(element, {
    animation: false, timeline: false, geocoder: false, homeButton: false,
    navigationHelpButton: false, sceneModePicker: false, baseLayerPicker: false,
    selectionIndicator: false, infoBox: false, fullscreenButton: false,
    baseLayer: false, shouldAnimate: true, requestRenderMode: false,
  })
  viewer.clock.clockRange = ClockRange.UNBOUNDED
  viewer.scene.globe.show = false
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = false
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false
  viewer.scene.backgroundColor = c('#dce6de')
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false
  viewer.scene.fog.enabled = false

  const width = initial.site.width_m
  const height = initial.site.height_m
  const layout = initial.initial_layout.map(p => ({ ...p }))
  const hubs = initial.site.hub_height_m
  let windDirection = initial.default_wind.direction
  let windSpeed = initial.default_wind.speed
  let phase = 0
  let selected: number | null = null
  let dragging: number | null = null
  let metrics: PowerResult | null = null
  let lastTime = performance.now()
  const turbines: Entity[][] = []
  const wakes: Entity[] = []
  const selectionRings: Entity[] = []

  const basePolygon = [localToWorld(-220, -200, -4), localToWorld(width + 220, -200, -4),
    localToWorld(width + 220, height + 200, -4), localToWorld(-220, height + 200, -4)]
  viewer.entities.add({
    name: 'Fictional northern Maine wind site',
    polygon: { hierarchy: new PolygonHierarchy(basePolygon), perPositionHeight: true,
      material: c('#a6bba3'), outline: false },
  })
  const inner = [localToWorld(0, 0, 0), localToWorld(width, 0, 0),
    localToWorld(width, height, 0), localToWorld(0, height, 0)]
  viewer.entities.add({
    polygon: { hierarchy: new PolygonHierarchy(inner), perPositionHeight: true,
      material: c('#d5dfcd'), outline: false },
  })
  const border = [...inner, inner[0]]
  viewer.entities.add({ polyline: { positions: border, width: 3,
    material: c('#4a6b5d', .67) } })
  for (let x = 0; x <= width; x += 200) {
    viewer.entities.add({ polyline: { positions: [localToWorld(x, 0, 1), localToWorld(x, height, 1)],
      width: 1, material: c('#65846f', .12) } })
  }
  for (let y = 0; y <= height; y += 200) {
    viewer.entities.add({ polyline: { positions: [localToWorld(0, y, 1), localToWorld(width, y, 1)],
      width: 1, material: c('#65846f', .12) } })
  }
  // Deterministic vegetation in the outer buffer: no network tiles, no tokens.
  let seed = 41831
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let k = 0; k < 90; k++) {
    const x = -210 + rand() * (width + 420)
    const y = -195 + rand() * (height + 390)
    if (x > 10 && x < width - 10 && y > 10 && y < height - 10) continue
    const r = 5 + rand() * 10
    viewer.entities.add({ position: localToWorld(x, y, 0),
      ellipse: { semiMajorAxis: r, semiMinorAxis: r * (.7 + rand() * .5), height: 0,
        material: c(rand() < .5 ? '#7f9d7e' : '#93ad88', .84) } })
  }
  // Non-quantitative flow guide lines; actual turbine penalties come from FLORIS.
  const flowLines: Entity[] = []
  for (let i = 0; i < 13; i++) {
    flowLines.push(viewer.entities.add({
      polyline: { positions: new CallbackProperty(() => {
        const theta = windDirection * Math.PI / 180
        const dx = -Math.sin(theta), dy = -Math.cos(theta)
        const cx = width / 2 + (i - 6) * (-dy) * 115
        const cy = height / 2 + (i - 6) * dx * 115
        const len = 1450
        return [localToWorld(cx - dx * len / 2, cy - dy * len / 2, 15),
          localToWorld(cx + dx * len / 2, cy + dy * len / 2, 15)]
      }, false), width: 1.1, material: c('#f9fff8', .29) },
    }))
  }

  function enuQuaternion(origin: Cartesian3): Quaternion {
    const frame = Transforms.eastNorthUpToFixedFrame(origin)
    return Quaternion.fromRotationMatrix(Matrix4.getMatrix3(frame, new Matrix3()))
  }
  const zDir = Cartesian3.UNIT_Z
  function alignedOrientation(point: Cartesian3, vector: Cartesian3): Quaternion {
    const dot = Math.min(1, Math.max(-1, Cartesian3.dot(zDir, vector)))
    const axis = Cartesian3.cross(zDir, vector, new Cartesian3())
    const angle = Math.acos(dot)
    const local = Math.abs(dot) > .99999
      ? (dot > 0 ? Quaternion.IDENTITY : Quaternion.fromAxisAngle(Cartesian3.UNIT_X, Math.PI))
      : Quaternion.fromAxisAngle(Cartesian3.normalize(axis, axis), angle)
    return Quaternion.multiply(enuQuaternion(point), local, new Quaternion())
  }

  for (let i = 0; i < layout.length; i++) {
    const components: Entity[] = []
    const p = () => layout[i]
    const at = (h: number, dx = 0, dy = 0) => localToWorld(p().x + dx, p().y + dy, h)
    const each = (item: Entity) => { components.push(item); return item }
    each(viewer.entities.add({
      id: `turbine-${i}-tower`, name: `Turbine ${String(i + 1).padStart(2, '0')}`,
      position: new CallbackPositionProperty(() => at(hubs / 2), false),
      cylinder: { length: hubs, topRadius: 2.7, bottomRadius: 5.4,
        material: c('#f5f7f3') },
    }))
    each(viewer.entities.add({
      id: `turbine-${i}-nacelle`, name: `Turbine ${i + 1}`,
      position: new CallbackPositionProperty(() => at(hubs + 4), false),
      box: { dimensions: new Cartesian3(23, 9, 8.5), material: c('#eef3f2') },
    }))
    each(viewer.entities.add({
      id: `turbine-${i}-hub`, name: `Turbine ${i + 1}`,
      position: new CallbackPositionProperty(() => at(hubs + 4, -14), false),
      ellipsoid: { radii: new Cartesian3(5.5, 5.5, 5.5), material: c('#e8efee') },
    }))
    for (let blade = 0; blade < 3; blade++) {
      const angle = () => phase + blade * (Math.PI * 2 / 3)
      const bladePosition = () => at(hubs + 4 + 31 * Math.cos(angle()), -14, 31 * Math.sin(angle()))
      each(viewer.entities.add({
        id: `turbine-${i}-blade-${blade}`, name: `Turbine ${i + 1}`,
        position: new CallbackPositionProperty(bladePosition, false),
        orientation: new CallbackProperty(() => {
          const center = bladePosition()
          return alignedOrientation(center,
            new Cartesian3(0, Math.sin(angle()), Math.cos(angle())))
        }, false),
        cylinder: new CylinderGraphics({ length: 57, topRadius: .35, bottomRadius: 2.5,
          material: c('#f2f5f0') }),
      }))
    }
    const ring = viewer.entities.add({ position: new CallbackPositionProperty(() => at(2), false),
      ellipse: new EllipseGraphics({ semiMajorAxis: 95, semiMinorAxis: 95, height: 2,
        material: c('#d5f4eb', .15), outline: true, outlineColor: c('#3c7f71', .86),
        show: new ConstantProperty(false) }),
    })
    selectionRings.push(ring)
    turbines.push(components)
    const wake = viewer.entities.add({
      name: `Wake ${i + 1}`,
      position: new CallbackPositionProperty(() => {
        const theta = windDirection * Math.PI / 180
        return at(hubs + 4, -Math.sin(theta) * 240, -Math.cos(theta) * 240)
      }, false),
      orientation: new CallbackProperty(() => {
        const center = at(hubs + 4)
        const theta = windDirection * Math.PI / 180
        return alignedOrientation(center, new Cartesian3(-Math.sin(theta), -Math.cos(theta), 0))
      }, false),
      cylinder: { length: 480, topRadius: 110, bottomRadius: 30,
        material: new ColorMaterialProperty(new CallbackProperty(() => c('#56b7b5', metrics ? .075 + .13 * Math.min(1, metrics.turbines[i].wake_loss_pct / 45) : .10), false)),
        outline: false },
    })
    wakes.push(wake)
  }

  const home = () => viewer.camera.flyToBoundingSphere(
    new BoundingSphere(localToWorld(width / 2, height / 2, 10), 1550),
    { duration: 1.3, offset: new HeadingPitchRange(CMath.toRadians(5), CMath.toRadians(-57), 3950) }
  )
  viewer.camera.lookAt(localToWorld(width / 2, height / 2, 0),
    new HeadingPitchRange(CMath.toRadians(5), CMath.toRadians(-58), 3950))
  viewer.camera.lookAtTransform(Matrix4.IDENTITY)

  const tick = () => {
    const now = performance.now()
    const delta = Math.min(.08, (now - lastTime) / 1000)
    lastTime = now
    phase += delta * (.08 + windSpeed * .07)
  }
  viewer.clock.onTick.addEventListener(tick)
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  const parseId = (id: unknown) => {
    if (typeof id !== 'string') return null
    const m = /^turbine-(\d+)-/.exec(id)
    return m ? Number(m[1]) : null
  }
  const pickIndex = (screen: Cartesian2) => {
    const picked = viewer.scene.pick(screen) as { id?: Entity } | undefined
    return parseId(picked?.id?.id)
  }
  handler.setInputAction((movement: { position: Cartesian2 }) => {
    const id = pickIndex(movement.position)
    if (id !== null) {
      dragging = id
      selected = id
      viewer.scene.screenSpaceCameraController.enableRotate = false
      viewer.scene.screenSpaceCameraController.enableTranslate = false
      hooks.onSelect(id)
      hooks.onMoveStart()
    }
  }, ScreenSpaceEventType.LEFT_DOWN)
  handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
    if (dragging === null) return
    const ellipsoidHit = viewer.camera.pickEllipsoid(movement.endPosition)
    if (!ellipsoidHit) return
    const target = worldToLocal(ellipsoidHit)
    if (hooks.onMove(dragging, target)) {
      layout[dragging] = blend(layout[dragging], target, 1)
    }
  }, ScreenSpaceEventType.MOUSE_MOVE)
  handler.setInputAction(() => {
    if (dragging !== null) {
      const moved = dragging
      dragging = null
      viewer.scene.screenSpaceCameraController.enableRotate = true
      viewer.scene.screenSpaceCameraController.enableTranslate = true
      hooks.onMoveEnd(moved)
    }
  }, ScreenSpaceEventType.LEFT_UP)
  handler.setInputAction((movement: { position: Cartesian2 }) => {
    const id = pickIndex(movement.position)
    selected = id
    hooks.onSelect(id)
  }, ScreenSpaceEventType.LEFT_CLICK)

  return {
    setLayout(points) { points.forEach((p, i) => { layout[i] = { ...p } }) },
    setMetrics(value) { metrics = value },
    setWind(direction, speed) { windDirection = direction; windSpeed = speed },
    setWakesVisible(visible) { wakes.forEach(w => { w.show = visible }) },
    setSelected(index) { selected = index; selectionRings.forEach((r, i) => {
      const show = r.ellipse?.show as ConstantProperty | undefined
      show?.setValue(i === index)
    }) },
    flyHome: home,
    destroy() {
      void selected; void turbines; void wakes; void flowLines
      handler.destroy(); viewer.clock.onTick.removeEventListener(tick); viewer.destroy()
    },
  }
}
