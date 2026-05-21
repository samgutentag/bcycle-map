import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Flex, Paper, SegmentedControl, Text } from '@audius/harmony'
import { useStableVerb } from '../lib/spinner-verbs'
import type { Leaderboards } from '@shared/leaderboards'

type WindowKey = '30d' | 'all'

type Props = {
  data: Leaderboards | null
  stations: Array<{ station_id: string; name: string }>
  loading: boolean
  /** Unix seconds; if the rollup is older than 48h we show the empty state. */
  nowTs?: number
}

const STALE_AFTER_SEC = 48 * 3600

export default function PopularRoutesTile({ data, stations, loading, nowTs }: Props) {
  const verb = useStableVerb()
  const [windowKey, setWindowKey] = useState<WindowKey>('30d')
  const nameById = useMemo(() => new Map(stations.map(s => [s.station_id, s.name])), [stations])

  if (loading) {
    return (
      <Flex direction="column" gap="xs" aria-busy="true">
        <Text variant="body" size="s" color="subdued">{verb}</Text>
        {Array.from({ length: 5 }).map((_, i) => (
          <Paper key={i} p="s" borderRadius="s" border="default" css={{ height: 36, opacity: 0.4 }} />
        ))}
      </Flex>
    )
  }

  const now = nowTs ?? Math.floor(Date.now() / 1000)
  const isStale = !!data && now - data.generated_at > STALE_AFTER_SEC
  const win = data?.windows[windowKey]
  const rows = win?.routes ?? []

  if (!data || isStale || rows.length === 0) {
    return (
      <Flex direction="column" gap="s">
        <SegmentedControl
          options={[{ key: '30d', text: '30d' }, { key: 'all', text: 'All' }]}
          selected={windowKey}
          onSelectOption={setWindowKey}
        />
        <Text variant="body" size="s" color="subdued">Not enough data yet.</Text>
      </Flex>
    )
  }

  return (
    <Flex direction="column" gap="s">
      <SegmentedControl
        options={[{ key: '30d', text: '30d' }, { key: 'all', text: 'All' }]}
        selected={windowKey}
        onSelectOption={setWindowKey}
      />
      <Flex direction="column" gap="xs">
        {rows.map((row, i) => {
          const fromName = nameById.get(row.from) ?? row.from
          const toName = nameById.get(row.to) ?? row.to
          const label = `${fromName} → ${toName}`
          return (
            <Paper
              key={`${row.from}-${row.to}`}
              p="s"
              borderRadius="s"
              border="default"
              direction="row"
              alignItems="center"
              gap="m"
            >
              <Text variant="body" size="s" color="subdued" css={{ width: 24, textAlign: 'right' }}>{i + 1}.</Text>
              <Link
                to={`/route/${row.from}/${row.to}`}
                style={{ flex: 1, textDecoration: 'none', minWidth: 0 }}
              >
                <Text
                  variant="body"
                  size="s"
                  color="default"
                  css={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {label}
                </Text>
              </Link>
              <Text
                variant="body"
                size="s"
                strength="strong"
                color="heading"
                title="Inferred trips"
                css={{ minWidth: 32, textAlign: 'right' }}
              >
                {row.trips}
              </Text>
            </Paper>
          )
        })}
      </Flex>
    </Flex>
  )
}
