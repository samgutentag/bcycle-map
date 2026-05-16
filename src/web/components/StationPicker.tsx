import { useEffect, useMemo, useRef, useState } from 'react'
import type { StationSnapshot } from '@shared/types'

type Props = {
  label: string
  value: string | null
  stations: StationSnapshot[]
  onChange: (stationId: string | null) => void
}

const PANEL_MAX_HEIGHT = 240

export default function StationPicker({ label, value, stations, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const sorted = useMemo(
    () => [...stations].sort((a, b) => a.name.localeCompare(b.name)),
    [stations],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(s => s.name.toLowerCase().includes(q))
  }, [sorted, query])

  const selected = value ? stations.find(s => s.station_id === value) : null

  // Reset active row when filter changes
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Auto-focus the input when the panel opens
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the active option scrolled into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  function commit(stationId: string | null) {
    onChange(stationId)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const choice = filtered[activeIndex]
      if (choice) commit(choice.station_id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className="flex flex-col gap-1 text-sm" ref={rootRef}>
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      <div className="relative" onKeyDown={onKeyDown}>
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${label}-listbox`}
          onClick={() => setOpen(o => !o)}
          className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-white text-left text-neutral-900 focus:outline-none focus:ring-2 focus:ring-sky-500 flex items-center justify-between gap-2"
        >
          <span className={selected ? '' : 'text-neutral-500'}>
            {selected ? selected.name : 'Select a station…'}
          </span>
          <span aria-hidden className="text-neutral-400 text-xs">▾</span>
        </button>
        {open && (
          <div
            className="absolute z-20 mt-1 left-0 right-0 rounded-md border border-neutral-300 bg-white shadow-lg overflow-hidden"
          >
            <input
              ref={inputRef}
              type="text"
              role="searchbox"
              aria-label={`Filter ${label.toLowerCase()} stations`}
              placeholder="Filter…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full px-3 py-2 border-b border-neutral-200 text-sm text-neutral-900 focus:outline-none"
            />
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-neutral-500">No matches.</div>
            ) : (
              <ul
                ref={listRef}
                id={`${label}-listbox`}
                role="listbox"
                aria-label={`${label} stations`}
                className="overflow-y-auto"
                style={{ maxHeight: PANEL_MAX_HEIGHT }}
              >
                {filtered.map((s, i) => {
                  const active = i === activeIndex
                  const isSelected = s.station_id === value
                  return (
                    <li
                      key={s.station_id}
                      role="option"
                      aria-selected={isSelected}
                      onPointerEnter={() => setActiveIndex(i)}
                      onClick={() => commit(s.station_id)}
                      className={
                        `px-3 py-2 text-sm cursor-pointer ${active ? 'bg-sky-50 text-sky-900' : 'text-neutral-900'} ${isSelected ? 'font-semibold' : ''}`
                      }
                    >
                      {s.name}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
