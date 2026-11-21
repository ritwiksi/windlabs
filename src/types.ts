export type Point = { x: number; y: number }
export type Config = {
  site: { width_m: number; height_m: number; min_spacing_m: number; rotor_diameter_m: number; hub_height_m: number }
  initial_layout: Point[]
  wind_resource: { source: string; reference: string; period: string; method: string; is_historical: boolean; notice: string; source_url?: string }
  default_wind: { speed: number; direction: number }
  turbine_count: number
}
export type PowerResult = {
  power_mw: number
  aep_mwh: number
  annual_wake_loss_pct: number
  instant_wake_loss_pct: number
  turbines: { id: number; power_mw: number; wake_loss_pct: number }[]
}
export type OptimizeResult = {
  accepted: boolean
  message: string
  layout: Point[]
  baseline: { aep_mwh: number; annual_wake_loss_pct: number }
  optimized: { aep_mwh: number; annual_wake_loss_pct: number }
  improvement_pct: number
}
