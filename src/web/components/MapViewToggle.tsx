export type MapView = 'pins' | 'heatmap'

type Props = {
  value: MapView
  onChange: (view: MapView) => void
}

export default function MapViewToggle({ value, onChange }: Props) {
  return (
    <div className="absolute top-4 left-4 inline-flex gap-1 p-1 bg-white rounded-lg shadow-md border border-neutral-200 text-sm z-10">
      <button
        type="button"
        onClick={() => onChange('pins')}
        className={
          value === 'pins'
            ? 'px-3 py-1 rounded-md bg-sky-700 text-white font-medium'
            : 'px-3 py-1 rounded-md text-neutral-700 hover:text-neutral-900'
        }
        title="Show station pins with bike/dock counts"
      >
        Pins
      </button>
      <button
        type="button"
        onClick={() => onChange('heatmap')}
        className={
          value === 'heatmap'
            ? 'px-3 py-1 rounded-md bg-sky-700 text-white font-medium'
            : 'px-3 py-1 rounded-md text-neutral-700 hover:text-neutral-900'
        }
        title="Show available bikes as a hex heatmap"
      >
        Heatmap
      </button>
    </div>
  )
}
