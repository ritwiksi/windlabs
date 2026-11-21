import type { Config, OptimizeResult, Point, PowerResult } from './types'

const base = import.meta.env.VITE_API_BASE_URL || ''

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { detail?: string } | null
    throw new Error(data?.detail ?? `Server returned ${res.status}`)
  }
  return res.json() as Promise<T>
}
export async function getConfig(): Promise<Config> {
  return unwrap<Config>(await fetch(`${base}/api/config`))
}
function post<T>(endpoint: string, layout: Point[], windSpeed: number, windDirection: number, signal?: AbortSignal) {
  return fetch(`${base}/api/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, wind_speed: windSpeed, wind_direction: windDirection }), signal,
  }).then(unwrap<T>)
}
export function simulate(layout: Point[], speed: number, direction: number, signal?: AbortSignal) {
  return post<PowerResult>('simulate', layout, speed, direction, signal)
}
export function optimize(layout: Point[], speed: number, direction: number) {
  return post<OptimizeResult>('optimize', layout, speed, direction)
}
