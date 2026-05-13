import { StationSnapshot } from './types'
import { tableFromJSON, tableFromIPC, tableToIPC } from 'apache-arrow'
import {
  readParquet,
  writeParquet,
  Table as WasmTable,
  WriterPropertiesBuilder,
  Compression,
} from 'parquet-wasm/bundler'

export type SnapshotRow = {
  snapshot_ts: number
  station: StationSnapshot
}

// Flat row layout written to the parquet file. One row per station snapshot.
type FlatRow = {
  snapshot_ts: number
  station_id: string
  name: string
  lat: number
  lon: number
  address: string
  num_bikes_available: number
  num_docks_available: number
  bikes_electric: number
  bikes_classic: number
  bikes_smart: number
  is_installed: boolean
  is_renting: boolean
  is_returning: boolean
  last_reported: number
}

function flatten(rows: SnapshotRow[]): FlatRow[] {
  return rows.map((r) => ({
    snapshot_ts: r.snapshot_ts,
    station_id: r.station.station_id,
    name: r.station.name,
    lat: r.station.lat,
    lon: r.station.lon,
    address: r.station.address ?? '',
    num_bikes_available: r.station.num_bikes_available,
    num_docks_available: r.station.num_docks_available,
    bikes_electric: r.station.bikes_electric,
    bikes_classic: r.station.bikes_classic,
    bikes_smart: r.station.bikes_smart,
    is_installed: r.station.is_installed,
    is_renting: r.station.is_renting,
    is_returning: r.station.is_returning,
    last_reported: r.station.last_reported,
  }))
}

// wasm-bindgen objects expose `.free()`, but consuming calls like `writeParquet` and
// `intoIPCStream` already destroy the object internally. Calling `.free()` twice trips a
// "null pointer passed to rust" error. The `__wbg_ptr` field is zeroed on destruction, so
// only free when it's still non-zero — that way exceptions before consumption still clean up.
type WasmFreeable = { free(): void; __wbg_ptr?: number }

function freeIfAlive(obj: WasmFreeable | null | undefined): void {
  if (obj && obj.__wbg_ptr !== 0) obj.free()
}

export async function snapshotsToParquet(rows: SnapshotRow[]): Promise<Uint8Array> {
  const arrowTable = tableFromJSON(flatten(rows))
  const ipc = tableToIPC(arrowTable, 'stream')
  // WASM-allocated objects need explicit .free() so long-running Workers don't leak.
  const wasmTable = WasmTable.fromIPCStream(ipc) as unknown as WasmFreeable
  try {
    const writerProperties = new WriterPropertiesBuilder()
      .setCompression(Compression.SNAPPY)
      .build() as unknown as WasmFreeable
    try {
      return writeParquet(wasmTable as never, writerProperties as never)
    } finally {
      freeIfAlive(writerProperties)
    }
  } finally {
    freeIfAlive(wasmTable)
  }
}

export async function parquetToSnapshots(buf: Uint8Array): Promise<SnapshotRow[]> {
  const wasmTable = readParquet(buf) as unknown as WasmFreeable & {
    intoIPCStream(): Uint8Array
  }
  let records: FlatRow[]
  try {
    const arrowTable = tableFromIPC(wasmTable.intoIPCStream())
    records = arrowTable.toArray() as unknown as FlatRow[]
  } finally {
    freeIfAlive(wasmTable)
  }

  return records.map((r) => {
    const station: StationSnapshot = {
      station_id: r.station_id,
      name: r.name,
      lat: Number(r.lat),
      lon: Number(r.lon),
      num_bikes_available: Number(r.num_bikes_available),
      num_docks_available: Number(r.num_docks_available),
      bikes_electric: Number(r.bikes_electric),
      bikes_classic: Number(r.bikes_classic),
      bikes_smart: Number(r.bikes_smart),
      is_installed: Boolean(r.is_installed),
      is_renting: Boolean(r.is_renting),
      is_returning: Boolean(r.is_returning),
      last_reported: Number(r.last_reported),
    }
    if (r.address && r.address.length > 0) station.address = r.address
    return {
      snapshot_ts: Number(r.snapshot_ts),
      station,
    }
  })
}
