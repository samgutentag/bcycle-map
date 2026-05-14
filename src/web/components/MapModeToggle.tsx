export type MapMode = 'bikes' | 'docks'

type Props = {
  value: MapMode
  onChange: (mode: MapMode) => void
}

export default function MapModeToggle({ value, onChange }: Props) {
  return (
    <div className="absolute top-4 left-4 inline-flex gap-1 p-1 bg-white rounded-lg shadow-md border border-neutral-200 text-sm">
      <button
        type="button"
        onClick={() => onChange('bikes')}
        className={
          value === 'bikes'
            ? 'px-3 py-1 rounded-md bg-sky-700 text-white font-medium'
            : 'px-3 py-1 rounded-md text-neutral-700 hover:text-neutral-900'
        }
        title="Show available bikes on each pin"
      >
        Bikes
      </button>
      <button
        type="button"
        onClick={() => onChange('docks')}
        className={
          value === 'docks'
            ? 'px-3 py-1 rounded-md bg-sky-700 text-white font-medium'
            : 'px-3 py-1 rounded-md text-neutral-700 hover:text-neutral-900'
        }
        title="Show open docks on each pin"
      >
        Open docks
      </button>
    </div>
  )
}
