import { useTheme } from '@audius/harmony'

type Props = {
  enabled: boolean
  onToggle: () => void
}

/**
 * Compact "Fog" toggle for /flow (#57). Sits in the top-right of the map
 * surface. Off by default; persistence is owned by the parent via the
 * `bcycle-map:flow-fog-enabled` localStorage key.
 *
 * Intentionally small and unlabeled-elsewhere — this is an opt-in novelty
 * view, not a primary action.
 */
export default function FogToggle({ enabled, onToggle }: Props) {
  const theme = useTheme()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Toggle fog of the world view"
      title={enabled ? 'Fog: on (click to disable)' : 'Fog: off (click to enable)'}
      onClick={onToggle}
      data-testid="fog-toggle"
      css={{
        all: 'unset',
        cursor: 'pointer',
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 10,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.92)',
        border: `1px solid ${theme.color.border.default}`,
        fontSize: 12,
        fontWeight: 600,
        color: enabled ? theme.color.text.heading : theme.color.text.subdued,
        boxShadow: theme.shadows.near,
        transition: `color ${theme.motion.quick}, background ${theme.motion.quick}`,
        '&:hover': { background: 'rgba(255,255,255,1)' },
        '&:focus-visible': {
          outline: `2px solid ${theme.color.focus.default}`,
          outlineOffset: 1,
        },
      }}
    >
      <span
        aria-hidden
        data-testid="fog-toggle-dot"
        css={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: enabled ? '#0d6cb0' : 'rgba(120,120,120,0.45)',
          boxShadow: enabled ? '0 0 4px rgba(13,108,176,0.6)' : 'none',
          transition: `background ${theme.motion.quick}`,
        }}
      />
      Fog
    </button>
  )
}
