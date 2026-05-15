import { Flex, IconError, IconRefresh, Text, useTheme } from '@audius/harmony'

type Props = { ageSec: number; snapshotTs: number }

function formatLastUpdate(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Live map staleness indicator. Two-tier:
 *  - >3 min, <=10 min: amber pill in the top-right showing minutes ago.
 *  - >10 min: prominent red banner centered at the top with the last update time.
 *
 * Visibility is intentional — the data feed should rarely be stale, so when it
 * happens we want users to notice immediately.
 */
export default function StalenessBadge({ ageSec, snapshotTs }: Props) {
  const theme = useTheme()
  if (ageSec < 180) return null
  if (ageSec <= 600) {
    const minutes = Math.round(ageSec / 60)
    return (
      <Flex
        alignItems="center"
        gap="xs"
        css={{
          position: 'absolute',
          top: 16,
          right: 16,
          padding: `${theme.spacing.xs}px ${theme.spacing.s}px`,
          borderRadius: theme.cornerRadius.s,
          background: theme.color.status.warning,
          color: theme.color.text.staticWhite,
          boxShadow: theme.shadows.near,
        }}
      >
        <IconRefresh size="xs" color="white" />
        <Text variant="label" size="xs" strength="strong" color="white">
          {minutes}m ago
        </Text>
      </Flex>
    )
  }
  return (
    <Flex
      alignItems="center"
      gap="s"
      css={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: `${theme.spacing.s}px ${theme.spacing.m}px`,
        borderRadius: theme.cornerRadius.s,
        background: theme.color.status.danger,
        color: theme.color.text.staticWhite,
        boxShadow: theme.shadows.mid,
      }}
    >
      <IconError size="s" color="white" />
      <Text variant="body" size="s" strength="strong" color="white">
        Feed appears stale — last update at {formatLastUpdate(snapshotTs)}
      </Text>
    </Flex>
  )
}
