import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { parquetReadObjects } from 'hyparquet'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Sample = {
  station_id: string
  snapshot_ts: number
  num_bikes_available: number
  num_docks_available: number
}

export type HourCell = {
  hour: number
  bikes: number
  docks: number
  samples: number
}

export type TypicalProfile = {
  stationId: string
  computedAt: number
  daysCovered: number
  byDow: HourCell[][]   // length 7, each entry is 24 cells
  allDays: HourCell[]   // length 24
}

export function localPartsForTs(ts: number, timezone: string): { dow: number; hour: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(ts * 1000))
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Sun'
  const year = parts.find(p => p.type === 'year')?.value ?? '1970'
  const month = parts.find(p => p.type === 'month')?.value ?? '01'
  const day = parts.find(p => p.type === 'day')?.value ?? '01'
  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '0'
  const hour = Number(hourStr === '24' ? '0' : hourStr)
  const dow = WEEKDAYS.indexOf(weekday)
  return { dow: dow < 0 ? 0 : dow, hour, dateKey: `${year}-${month}-${day}` }
}

/**
 * Aggregate all samples into per-station typical profiles.
 * For each station, builds: (a) a 7×24 grid keyed by day-of-week + hour,
 * and (b) a 24-cell all-days average. The latter is the fallback when a
 * station has too few unique days of coverage to trust DOW filtering.
 */
export function aggregateTypicals(samples: Sample[], timezone: string, nowTs = Math.floor(Date.now() / 1000)): Map<string, TypicalProfile> {
  type Cell = { bikes: number; docks: number; n: number }
  const byStation = new Map<string, {
    byDow: Cell[][]
    allDays: Cell[]
    dates: Set<string>
  }>()

  const emptyCell = (): Cell => ({ bikes: 0, docks: 0, n: 0 })
  const emptyRow = (): Cell[] => Array.from({ length: 24 }, emptyCell)

  for (const s of samples) {
    const parts = localPartsForTs(s.snapshot_ts, timezone)
    let entry = byStation.get(s.station_id)
    if (!entry) {
      entry = {
        byDow: Array.from({ length: 7 }, emptyRow),
        allDays: emptyRow(),
        dates: new Set(),
      }
      byStation.set(s.station_id, entry)
    }
    const dowRow = entry.byDow[parts.dow]!
    const dowCell = dowRow[parts.hour]!
    dowCell.bikes += s.num_bikes_available
    dowCell.docks += s.num_docks_available
    dowCell.n += 1
    const allCell = entry.allDays[parts.hour]!
    allCell.bikes += s.num_bikes_available
    allCell.docks += s.num_docks_available
    allCell.n += 1
    entry.dates.add(parts.dateKey)
  }

  const result = new Map<string, TypicalProfile>()
  for (const [stationId, entry] of byStation) {
    const reduce = (cells: Cell[]): HourCell[] =>
      cells.map((c, hour) => ({
        hour,
        bikes: c.n > 0 ? Math.round((c.bikes / c.n) * 10) / 10 : 0,
        docks: c.n > 0 ? Math.round((c.docks / c.n) * 10) / 10 : 0,
        samples: c.n,
      }))
    result.set(stationId, {
      stationId,
      computedAt: nowTs,
      daysCovered: entry.dates.size,
      byDow: entry.byDow.map(reduce),
      allDays: reduce(entry.allDays),
    })
  }
  return result
}

export type ListedKey = { Key?: string }

export async function computeTypicalsForSystem(opts: {
  s3: S3Client
  bucket: string
  systemId: string
  timezone: string
}): Promise<{ stationsWritten: number; daysCovered: number }> {
  const prefix = `gbfs/${opts.systemId}/station_status/`
  const allKeys: string[] = []
  let continuationToken: string | undefined
  do {
    const list = await opts.s3.send(new ListObjectsV2Command({
      Bucket: opts.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }))
    for (const obj of list.Contents ?? []) {
      if (!obj.Key) continue
      if (!/dt=\d{4}-\d{2}-\d{2}\/\d{2}\.parquet$/.test(obj.Key)) continue
      allKeys.push(obj.Key)
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (continuationToken)
  allKeys.sort()

  // Stream samples from every parquet file
  const allSamples: Sample[] = []
  for (const key of allKeys) {
    const got = await opts.s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }))
    const ab = await got.Body!.transformToByteArray()
    const rows = await parquetReadObjects({
      file: ab.buffer as ArrayBuffer,
      columns: ['snapshot_ts', 'station_id', 'num_bikes_available', 'num_docks_available'],
    }) as Array<{ snapshot_ts: bigint | number; station_id: string; num_bikes_available: number; num_docks_available: number }>
    for (const r of rows) {
      allSamples.push({
        station_id: String(r.station_id),
        snapshot_ts: typeof r.snapshot_ts === 'bigint' ? Number(r.snapshot_ts) : r.snapshot_ts,
        num_bikes_available: Number(r.num_bikes_available),
        num_docks_available: Number(r.num_docks_available),
      })
    }
  }

  const profiles = aggregateTypicals(allSamples, opts.timezone)

  let written = 0
  let maxDays = 0
  for (const [stationId, profile] of profiles) {
    await opts.s3.send(new PutObjectCommand({
      Bucket: opts.bucket,
      Key: `gbfs/${opts.systemId}/typicals/${stationId}.json`,
      Body: JSON.stringify(profile),
      ContentType: 'application/json',
    }))
    written++
    if (profile.daysCovered > maxDays) maxDays = profile.daysCovered
  }
  return { stationsWritten: written, daysCovered: maxDays }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  for (const k of ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'SYSTEM_ID', 'SYSTEM_TIMEZONE']) {
    if (!env[k]) throw new Error(`missing env ${k}`)
  }
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.CF_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
  })
  computeTypicalsForSystem({
    s3,
    bucket: env.R2_BUCKET!,
    systemId: env.SYSTEM_ID!,
    timezone: env.SYSTEM_TIMEZONE!,
  }).then(r => {
    console.log(`typicals: wrote ${r.stationsWritten} stations, max days covered: ${r.daysCovered}`)
  }, e => {
    console.error('typicals failed:', e)
    process.exit(1)
  })
}
