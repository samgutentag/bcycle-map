import type { StationSnapshot } from '@shared/types'

type Props = {
  label: string
  value: string | null
  stations: StationSnapshot[]
  onChange: (stationId: string | null) => void
}

export default function StationPicker({ label, value, stations, onChange }: Props) {
  // Stable name order so users can scan alphabetically
  const sorted = [...stations].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="px-3 py-2 rounded-md border border-neutral-300 bg-white text-neutral-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <option value="">Select a station…</option>
        {sorted.map(s => (
          <option key={s.station_id} value={s.station_id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}
