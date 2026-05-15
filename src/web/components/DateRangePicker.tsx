import { SegmentedControl } from '@audius/harmony'
import type { Preset } from '../lib/date-range'

type Props = {
  value: Preset
  onChange: (preset: Preset) => void
}

const OPTIONS: { key: Preset; text: string }[] = [
  { key: '24h', text: '24h' },
  { key: '7d', text: '7d' },
  { key: '30d', text: '30d' },
  { key: 'all', text: 'All' },
]

export default function DateRangePicker({ value, onChange }: Props) {
  return (
    <SegmentedControl
      options={OPTIONS}
      selected={value}
      onSelectOption={onChange}
    />
  )
}
