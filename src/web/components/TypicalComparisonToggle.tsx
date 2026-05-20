import { Flex, Text, useTheme } from '@audius/harmony'

type Props = {
  value: boolean
  onChange: (next: boolean) => void
}

/**
 * Overlay toggle for the pin-border "typical comparison" ring on /live (#39).
 * Stacks above the basemap toggle in the bottom-right control strip so
 * basemap-area controls cluster together; the nearby-trigger sits to the
 * left, SystemTotals owns the top-right.
 *
 * When on, every pin gains a green or amber ring reflecting how its
 * current bike count compares to the day-of-week + hour-of-day baseline.
 * Default state is ON; persistence lives at the LiveMap level via the
 * `bcycle-map:show-typical-comparison` localStorage key.
 */
export default function TypicalComparisonToggle({ value, onChange }: Props) {
  const theme = useTheme()
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      title={value ? 'Hide typical-vs-now ring' : 'Show typical-vs-now ring on every pin'}
      data-testid="typical-comparison-toggle"
      css={{
        all: 'unset',
        cursor: 'pointer',
        position: 'absolute',
        bottom: 56,
        right: 16,
        zIndex: 10,
        padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
        borderRadius: theme.cornerRadius.s,
        boxShadow: theme.shadows.mid,
        border: `1px solid ${value ? theme.color.background.accent : theme.color.border.default}`,
        background: value ? theme.color.background.accent : theme.color.background.white,
        color: value ? theme.color.text.staticWhite : theme.color.text.default,
        display: 'inline-flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        transition: `background ${theme.motion.quick}, color ${theme.motion.quick}, box-shadow ${theme.motion.quick}`,
        '&:hover': { boxShadow: theme.shadows.far },
        '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 2 },
      }}
    >
      <Flex alignItems="center" gap="xs">
        {/* Two-tone ring glyph: green half (above) + amber half (below) to
            telegraph what the toggle controls without needing a legend. */}
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="#16a34a" strokeWidth="2" strokeDasharray="8.6 17.3" strokeDashoffset="0" />
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="8.6 17.3" strokeDashoffset="-8.6" />
        </svg>
        <Text variant="label" size="s" strength="strong" color="inherit">
          {value ? 'Typical on' : 'Typical ring'}
        </Text>
      </Flex>
    </button>
  )
}
