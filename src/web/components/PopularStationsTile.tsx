import { Link } from 'react-router-dom'
import { Flex, Paper, Text } from '@audius/harmony'
import { useStableVerb } from '../lib/spinner-verbs'

type Props = {
  top: Array<{ station_id: string; count: number }>
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
        return (
          <Paper key={row.station_id} p="s" borderRadius="s" border="default" direction="row" alignItems="center" gap="m">
            <Text variant="body" size="s" color="subdued" css={{ width: 24, textAlign: 'right' }}>{i + 1}.</Text>
            <Link to={`/station/${row.station_id}/details`} style={{ flex: 1, textDecoration: 'none' }}>
              <Text variant="body" size="s" color="default">{name}</Text>
            </Link>
            <Text variant="body" size="s" strength="strong" color="heading">{row.count}</Text>
          </Paper>
        )
      })}
    </Flex>
  )
}
