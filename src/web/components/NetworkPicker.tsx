import { Text, useTheme } from '@audius/harmony'
import { useSystem } from '../context/SystemContext'

/**
 * Network switcher for the header. Hidden when only one network exists so the
 * single-system experience is unchanged. Native <select> for keyboard a11y,
 * styled to match the corridor chip pattern.
 */
export default function NetworkPicker() {
  const theme = useTheme()
  const { systemId, systems, setSystemId } = useSystem()
  if (systems.length < 2) return null

  return (
    <div
      css={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: theme.cornerRadius.s,
        border: `1px solid ${theme.color.border.default}`,
        background: theme.color.background.surface1,
        padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
      }}
    >
      <Text variant="label" size="s" strength="strong" color="default" css={{ whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        {systems.find(s => s.systemId === systemId)?.name ?? 'Network'}
      </Text>
      <select
        data-testid="network-picker"
        aria-label="Choose bike network"
        value={systemId}
        onChange={ev => setSystemId(ev.target.value)}
        css={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', border: 'none', background: 'transparent' }}
      >
        {systems.map(s => (
          <option key={s.systemId} value={s.systemId}>{s.name}</option>
        ))}
      </select>
    </div>
  )
}
