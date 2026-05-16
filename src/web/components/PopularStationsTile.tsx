import { Link } from 'react-router-dom'
import { Flex, Paper, Text } from '@audius/harmony'
import { useStableVerb } from '../lib/spinner-verbs'

type Row = {
  station_id: string
  count: number
  /** Optional — only present on rollups produced after the in/out split. */
  departures?: number
  arrivals?: number
}

type Props = {
  top: Row[]
  stations: Array<{ station_id: string; name: string }>
  loading: boolean
}

export default function PopularStationsTile({ top, stations, loading }: Props) {
  const verb = useStableVerb()
  const nameById = new Map(stations.map(s => [s.station_id, s.name]))

  if (loading) {
    return <Text variant="body" size="s" color="subdued">{verb}</Text>
  }
  if (top.length === 0) {
    return <Text variant="body" size="s" color="subdued">No popularity data yet — check back after the next rollup run.</Text>
  }

  return (
    <Flex direction="column" gap="xs">
      {top.map((row, i) => {
        const name = nameById.get(row.station_id) ?? row.station_id
        const hasBreakdown = row.departures !== undefined && row.arrivals !== undefined
        return (
          <Paper key={row.station_id} p="s" borderRadius="s" border="default" direction="row" alignItems="center" gap="m">
            <Text variant="body" size="s" color="subdued" css={{ width: 24, textAlign: 'right' }}>{i + 1}.</Text>
            <Link to={`/station/${row.station_id}/details`} style={{ flex: 1, textDecoration: 'none', minWidth: 0 }}>
              <Text variant="body" size="s" color="default" css={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Text>
            </Link>
            {hasBreakdown && (
              <Flex alignItems="baseline" gap="s">
                <Text
                  variant="body"
                  size="s"
                  strength="strong"
                  color="warning"
                  title="Bikes taken (departures)"
                >
                  ↑ {row.departures}
                </Text>
                <Text
                  variant="body"
                  size="s"
                  strength="strong"
                  css={(theme) => ({ color: theme.color.status.success })}
                  title="Bikes returned (arrivals)"
                >
                  ↓ {row.arrivals}
                </Text>
              </Flex>
            )}
            <Text
              variant="body"
              size="s"
              strength="strong"
              color="heading"
              title="Total events"
              css={{ minWidth: 32, textAlign: 'right' }}
            >
              {row.count}
            </Text>
          </Paper>
        )
      })}
    </Flex>
  )
}
