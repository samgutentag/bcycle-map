import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Flex, Paper, Text, useTheme } from '@audius/harmony'
import type { StationSnapshot } from '@shared/types'
import { formatRelative } from '../lib/relative-time'

const NEW_STATION_SEC = 14 * 86400

type Props = {
  stations: StationSnapshot[]
  nowSec: number
}

export default function NewStationsSection({ stations, nowSec }: Props) {
  const theme = useTheme()
  const newStations = useMemo(
    () => stations
      .filter(s => s.first_seen_ts && (nowSec - s.first_seen_ts) < NEW_STATION_SEC)
      .sort((a, b) => (b.first_seen_ts ?? 0) - (a.first_seen_ts ?? 0)),
    [stations, nowSec],
  )

  if (newStations.length === 0) return null

  return (
    <Paper p="m" borderRadius="m" shadow="near" border="default" direction="column" gap="s">
      <Text variant="label" size="xs" strength="strong" color="subdued" textTransform="uppercase">
        New Stations
      </Text>
      <Flex direction="column" gap="xs">
        {newStations.map(s => (
          <Flex
            key={s.station_id}
            alignItems="center"
            gap="xs"
            css={{ fontSize: 13, lineHeight: 1.3 }}
          >
            <span css={{
              background: '#f59e0b',
              color: 'white',
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 5px',
              borderRadius: 6,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              flexShrink: 0,
            }}>
              NEW
            </span>
            <Link
              to={`/station/${s.station_id}/details`}
              css={{
                flex: 1,
                minWidth: 0,
                fontWeight: 600,
                color: theme.color.text.default,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {s.name}
            </Link>
            <Text
              variant="body"
              size="xs"
              color="subdued"
              css={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
            >
              added {formatRelative(s.first_seen_ts!, nowSec)}
            </Text>
          </Flex>
        ))}
      </Flex>
    </Paper>
  )
}
