import { Flex, Text, useTheme } from '@audius/harmony'
import { useUnitSystem } from '../hooks/useUnitSystem'
import type { UnitSystem } from '../lib/units'

const OPTIONS: { value: UnitSystem; label: string; hint: string }[] = [
  { value: 'imperial', label: 'Imperial', hint: 'miles / feet' },
  { value: 'metric', label: 'Metric', hint: 'km / meters' },
]

/**
 * Two-way Imperial / Metric switch (#16). Persisted via the
 * `bcycle-map:unit-system` localStorage key by `UnitSystemProvider`.
 * Lives in the AboutModal — units are a one-time setting, not a
 * frequent action, so it doesn't earn header real estate.
 */
export default function UnitSystemToggle() {
  const { unitSystem, setUnitSystem } = useUnitSystem()
  const theme = useTheme()
  return (
    <Flex direction="column" gap="xs">
      <Text variant="label" size="s" color="subdued">
        Units
      </Text>
      <Flex
        role="radiogroup"
        aria-label="Units"
        gap="2xs"
        alignItems="center"
        css={{
          padding: 2,
          borderRadius: theme.cornerRadius.s,
          background: theme.color.background.surface1,
          border: `1px solid ${theme.color.border.default}`,
          alignSelf: 'flex-start',
        }}
      >
        {OPTIONS.map(({ value, label, hint }) => {
          const active = unitSystem === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${label} (${hint})`}
              title={`${label} (${hint})`}
              onClick={() => setUnitSystem(value)}
              css={{
                all: 'unset',
                cursor: 'pointer',
                minWidth: 88,
                padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.cornerRadius.xs,
                color: active ? theme.color.text.heading : theme.color.text.subdued,
                background: active ? theme.color.background.white : 'transparent',
                boxShadow: active ? theme.shadows.near : 'none',
                transition: `background ${theme.motion.quick}, color ${theme.motion.quick}`,
                '&:hover': { color: theme.color.text.default },
                '&:focus-visible': { outline: `2px solid ${theme.color.focus.default}`, outlineOffset: 1 },
              }}
            >
              <Text variant="label" size="s" strength={active ? 'strong' : 'default'} color="inherit">
                {label}
              </Text>
            </button>
          )
        })}
      </Flex>
    </Flex>
  )
}
