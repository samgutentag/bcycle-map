export type Basemap = 'clean' | 'cycling'

type Props = {
  value: Basemap
  onChange: (b: Basemap) => void
}

export default function BasemapToggle({ value, onChange }: Props) {
  return (
    <div className="absolute top-4 right-4 inline-flex gap-1 p-1 bg-white rounded-lg shadow-md border border-neutral-200 text-xs z-10">
      <button
        type="button"
        onClick={() => onChange('clean')}
        title="Clean light basemap — best for data overlays"
        className={
          value === 'clean'
            ? 'px-2 py-1 rounded-md bg-neutral-800 text-white font-medium'
            : 'px-2 py-1 rounded-md text-neutral-700 hover:text-neutral-900'
        }
      >
        Clean
      </button>
      <button
        type="button"
        onClick={() => onChange('cycling')}
        title="CyclOSM — shows bike lanes and cycling routes"
        className={
          value === 'cycling'
            ? 'px-2 py-1 rounded-md bg-neutral-800 text-white font-medium'
            : 'px-2 py-1 rounded-md text-neutral-700 hover:text-neutral-900'
        }
      >
        Cycling
      </button>
    </div>
  )
}
