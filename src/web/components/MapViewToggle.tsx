export type MapView = 'pins' | 'bikes' | 'docks'

type Props = {
  value: MapView
  onChange: (view: MapView) => void
}

const OPTIONS: { value: MapView; label: string; title: string }[] = [
  { value: 'pins', label: 'Pins', title: 'Show station pins with bike/dock counts' },
  { value: 'bikes', label: 'Bikes heatmap', title: 'Heatmap of available bikes' },
  { value: 'docks', label: 'Docks heatmap', title: 'Heatmap of open dock slots' },
]

export default function MapViewToggle({ value, onChange }: Props) {
  return (
    <div className="absolute top-4 left-4 inline-flex gap-1 p-1 bg-white rounded-lg shadow-md border border-neutral-200 text-sm z-10">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          title={opt.title}
          className={
            value === opt.value
              ? 'px-3 py-1 rounded-md bg-sky-700 text-white font-medium'
              : 'px-3 py-1 rounded-md text-neutral-700 hover:text-neutral-900'
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
