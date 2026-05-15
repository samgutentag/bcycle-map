import { Flex, Text, useTheme } from '@audius/harmony'
import { BikeGlyph } from './BrandMark'

export type Basemap = 'clean' | 'cycling'

type Props = {
  value: Basemap
  onChange: (b: Basemap) => void
}

/**
 * Overlay control toggling the CyclOSM bike-route basemap on/off. Anchored
 * top-right on the live map; matches the SystemTotals overlay's framing.
 */
export default function BasemapToggle({ value, onChange }: Props) {
  const theme = useTheme()
  const active = value === 'cycling'
  return (
    <button
      type="button"
      onClick={() => onChange(active ? 'clean' : 'cycling')}
      aria-pressed={active}
      title={active ? 'Hide bike-route basemap' : 'Show bike-route basemap (CyclOSM)'}
      css={{
        all: 'unset',
        cursor: 'pointer',
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
        padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
        borderRadius: theme.cornerRadius.s,
        boxShadow: theme.shadows.mid,
        border: `1px solid ${active ? theme.color.background.accent : theme.color.border.default}`,
        background: active ? theme.color.background.accent : theme.color.background.white,
        color: active ? theme.color.text.staticWhite : theme.color.text.default,
        display: 'inline-flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        transition: `background ${theme.motion.quick}, color ${theme.motion.quick}, box-shadow ${theme.motion.quick}`,
        '&:hover': { boxShadow: theme.shadows.far },
        '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 2 },
      }}
    >
      <Flex alignItems="center" gap="xs">
        <BikeGlyph size={16} />
        <Text variant="label" size="s" strength="strong" color="inherit">
          {active ? 'Cycling on' : 'Cycling routes'}
        </Text>
      </Flex>
    </button>
  )
}

