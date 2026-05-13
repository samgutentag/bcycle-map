import type { Preset } from '../lib/date-range'

type Props = {
  value: Preset
  onChange: (preset: Preset) => void
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
]

export default function DateRangePicker({ value, onChange }: Props) {
  return (
    <div className="inline-flex gap-1 p-1 bg-neutral-100 rounded-lg border border-neutral-200">
      {PRESETS.map(p => {
        const selected = p.value === value
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            className={
              selected
                ? 'px-3 py-1 text-sm font-medium rounded-md bg-white shadow-sm text-neutral-900'
                : 'px-3 py-1 text-sm rounded-md text-neutral-600 hover:text-neutral-900'
            }
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
