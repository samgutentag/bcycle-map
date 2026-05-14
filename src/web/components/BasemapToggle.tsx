export type Basemap = 'clean' | 'cycling'

type Props = {
  value: Basemap
  onChange: (b: Basemap) => void
}

export default function BasemapToggle({ value, onChange }: Props) {
  const active = value === 'cycling'
  return (
    <button
      type="button"
      onClick={() => onChange(active ? 'clean' : 'cycling')}
      title={active ? 'Hide bike-route basemap' : 'Show bike-route basemap (CyclOSM)'}
      aria-pressed={active}
      className={
        active
          ? 'absolute top-4 right-4 px-3 py-1.5 rounded-md bg-emerald-700 text-white text-xs font-medium shadow-md border border-emerald-800 z-10'
          : 'absolute top-4 right-4 px-3 py-1.5 rounded-md bg-white text-neutral-700 text-xs font-medium shadow-md border border-neutral-200 hover:text-neutral-900 z-10'
      }
    >
      {active ? '🚲 Cycling on' : '🚲 Show cycling routes'}
    </button>
  )
}
