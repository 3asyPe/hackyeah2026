import L from 'leaflet'
import type { Level } from '../api'

const cache = new Map<string, L.DivIcon>()

/** Severity-colored pin with an optional count badge (avoids Leaflet's broken default PNG icons under Vite). */
export function severityIcon(sev: Level | null | undefined, count?: number, selected = false): L.DivIcon {
  const k = `${sev ?? 'none'}|${count ?? ''}|${selected}`
  let icon = cache.get(k)
  if (!icon) {
    const badge = count != null && count > 0 ? `<span class="pin-badge">${count}</span>` : ''
    icon = L.divIcon({
      className: 'pin-wrap',
      html: `<span class="pin pin-${sev ?? 'none'}${selected ? ' pin-selected' : ''}"><span class="pin-core"></span>${badge}</span>`,
      iconSize: [30, 38],
      iconAnchor: [15, 36],
    })
    cache.set(k, icon)
  }
  return icon
}

export const pickIcon = L.divIcon({
  className: 'pin-wrap',
  html: '<span class="pin pin-pick"><span class="pin-core"></span></span>',
  iconSize: [30, 38],
  iconAnchor: [15, 36],
})

export const KRAKOW: [number, number] = [50.0614, 19.9366]
export const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTR = '&copy; OpenStreetMap contributors'
