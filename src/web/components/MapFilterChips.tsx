import { Flex, Text, useTheme } from '@audius/harmony'
import { MIN_BIKES_CYCLE, nextMinBikes } from '../lib/map-filters'

type Props = {
  minBikes: number
  offlineOnly: boolean
  onMinBikesChange: (value: number) => void
  onOfflineOnlyChange: (value: boolean) => void
  onReset: () => void
  filteredCount: number
  totalCount: number
}

function minBikesLabel(value: number): string {
  if (value <= 0) return 'Min bikes: Any'
  return `Min bikes: ${value}+`
}

/**
 * Top-of-map chip row for `/live`. Each chip is a toggle; active chips render
 * in the accent palette and expose a small `×` to clear just that one. A
 * "Reset" link appears when any filter is active.
 *
 * Visibility: the chips themselves never disappear so users can discover the
 * controls. The "showing X of Y stations" subline only renders when a filter
 * is actually applied — no need to remind users that 26 of 26 are visible.
 */
export default function MapFilterChips({
  minBikes,
  offlineOnly,
  onMinBikesChange,
  onOfflineOnlyChange,
  onReset,
  filteredCount,
  totalCount,
}: Props) {
  const theme = useTheme()
  const minBikesActive = minBikes > 0
  const anyActive = minBikesActive || offlineOnly

  const baseChip = {
    all: 'unset' as const,
    cursor: 'pointer' as const,
    padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
    borderRadius: 9999,
    border: `1px solid ${theme.color.border.default}`,
    background: theme.color.background.white,
    color: theme.color.text.default,
    boxShadow: theme.shadows.near,
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing.xs,
    transition: `background ${theme.motion.quick}, color ${theme.motion.quick}, border-color ${theme.motion.quick}`,
    '&:hover': { boxShadow: theme.shadows.mid },
    '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 2 },
  }
  const activeChip = {
    border: `1px solid ${theme.color.background.accent}`,
    background: theme.color.background.accent,
    color: theme.color.text.staticWhite,
  }

  return (
    <div
      data-testid="map-filter-chips"
      css={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: theme.spacing.xs,
        pointerEvents: 'none',
      }}
    >
      <Flex
        alignItems="center"
        gap="xs"
        css={{
          pointerEvents: 'auto',
          padding: `${theme.spacing.xs}px`,
          borderRadius: 9999,
          background: `color-mix(in srgb, ${theme.color.background.white} 90%, transparent)`,
          backdropFilter: 'saturate(160%) blur(8px)',
          border: `1px solid ${theme.color.border.default}`,
          boxShadow: theme.shadows.near,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {/* Min bikes chip */}
        <Flex alignItems="center" gap="xs">
          <button
            type="button"
            data-testid="filter-chip-min-bikes"
            aria-label={`${minBikesLabel(minBikes)} — click to cycle`}
            aria-pressed={minBikesActive}
            onClick={() => onMinBikesChange(nextMinBikes(minBikes))}
            css={{
              ...baseChip,
              ...(minBikesActive ? activeChip : null),
            }}
          >
            <Text variant="label" size="s" strength="strong" color="inherit">
              {minBikesLabel(minBikes)}
            </Text>
            {minBikesActive && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear min bikes filter"
                data-testid="filter-chip-min-bikes-clear"
                onClick={ev => {
                  ev.stopPropagation()
                  onMinBikesChange(0)
                }}
                onKeyDown={ev => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.stopPropagation()
                    ev.preventDefault()
                    onMinBikesChange(0)
                  }
                }}
                css={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  fontSize: 12,
                  lineHeight: 1,
                  cursor: 'pointer',
                  marginLeft: 2,
                  opacity: 0.85,
                  '&:hover': { opacity: 1 },
                }}
              >
                ×
              </span>
            )}
          </button>
        </Flex>

        {/* Offline only chip */}
        <button
          type="button"
          data-testid="filter-chip-offline"
          aria-label="Offline only"
          aria-pressed={offlineOnly}
          onClick={() => onOfflineOnlyChange(!offlineOnly)}
          css={{
            ...baseChip,
            ...(offlineOnly ? activeChip : null),
          }}
        >
          <Text variant="label" size="s" strength="strong" color="inherit">
            Offline only
          </Text>
          {offlineOnly && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear offline filter"
              data-testid="filter-chip-offline-clear"
              onClick={ev => {
                ev.stopPropagation()
                onOfflineOnlyChange(false)
              }}
              onKeyDown={ev => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.stopPropagation()
                  ev.preventDefault()
                  onOfflineOnlyChange(false)
                }
              }}
              css={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 14,
                height: 14,
                borderRadius: '50%',
                fontSize: 12,
                lineHeight: 1,
                cursor: 'pointer',
                marginLeft: 2,
                opacity: 0.85,
                '&:hover': { opacity: 1 },
              }}
            >
              ×
            </span>
          )}
        </button>

        {anyActive && (
          <button
            type="button"
            data-testid="filter-chip-reset"
            onClick={onReset}
            css={{
              all: 'unset',
              cursor: 'pointer',
              padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
              borderRadius: 9999,
              color: theme.color.text.subdued,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'underline',
              '&:hover': { color: theme.color.text.default },
              '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 2 },
            }}
          >
            Reset
          </button>
        )}

        {/* MIN_BIKES_CYCLE export is referenced for tests/type safety — no UI here. */}
        <span hidden data-cycle={MIN_BIKES_CYCLE.join(',')} />
      </Flex>

      {anyActive && (
        <div
          data-testid="filter-chip-count"
          css={{
            pointerEvents: 'auto',
            padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
            borderRadius: theme.cornerRadius.s,
            background: `color-mix(in srgb, ${theme.color.background.white} 90%, transparent)`,
            backdropFilter: 'saturate(160%) blur(8px)',
            border: `1px solid ${theme.color.border.default}`,
            boxShadow: theme.shadows.near,
            fontSize: 11,
            color: theme.color.text.subdued,
            fontWeight: 600,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          Showing {filteredCount} of {totalCount} stations
        </div>
      )}
    </div>
  )
}
