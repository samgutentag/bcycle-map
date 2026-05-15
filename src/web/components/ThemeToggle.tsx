import { Flex, IconSettings, useTheme } from '@audius/harmony'
import { ComponentType } from 'react'
import { useAppTheme, type ThemeMode } from '../theme'
import { IconMoon, IconSun } from './icons'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIcon = ComponentType<any>

const OPTIONS: { mode: ThemeMode; label: string; Icon: AnyIcon }[] = [
  { mode: 'light', label: 'Light', Icon: IconSun },
  { mode: 'auto', label: 'System', Icon: IconSettings },
  { mode: 'dark', label: 'Dark', Icon: IconMoon },
]

/**
 * 3-way light / system / dark switch. SegmentedControl ships with text labels
 * that read awkwardly at the top of a map page; we render our own compact
 * icon-only variant using theme tokens for parity with Harmony's look.
 */
export default function ThemeToggle() {
  const { mode, setMode } = useAppTheme()
  const theme = useTheme()
  return (
    <Flex
      role="radiogroup"
      aria-label="Theme"
      gap="2xs"
      alignItems="center"
      css={{
        padding: 2,
        borderRadius: theme.cornerRadius.s,
        background: theme.color.background.surface1,
        border: `1px solid ${theme.color.border.default}`,
      }}
    >
      {OPTIONS.map(({ mode: m, label, Icon }) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setMode(m)}
            css={{
              all: 'unset',
              cursor: 'pointer',
              width: 28,
              height: 24,
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
            <Icon size="s" color={active ? 'default' : 'subdued'} />
          </button>
        )
      })}
    </Flex>
  )
}
