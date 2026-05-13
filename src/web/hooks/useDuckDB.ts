import { useEffect, useState } from 'react'
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'

type State = {
  conn: AsyncDuckDBConnection | null
  loading: boolean
  error: Error | null
}

// Singleton promise — first caller initializes, subsequent callers reuse.
let _connPromise: Promise<AsyncDuckDBConnection> | null = null

async function initDuckDB(): Promise<AsyncDuckDBConnection> {
  const duckdb = await import('@duckdb/duckdb-wasm')
  const bundles = duckdb.getJsDelivrBundles()
  const bundle = await duckdb.selectBundle(bundles)
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' })
  )
  const worker = new Worker(workerUrl)
  const logger = new duckdb.ConsoleLogger()
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker!)
  const conn = await db.connect()
  await conn.query('INSTALL httpfs; LOAD httpfs;')
  URL.revokeObjectURL(workerUrl)
  return conn
}

export function useDuckDB(): State {
  const [conn, setConn] = useState<AsyncDuckDBConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!_connPromise) _connPromise = initDuckDB()
    _connPromise.then(
      c => {
        if (!cancelled) {
          setConn(c)
          setLoading(false)
        }
      },
      e => {
        if (!cancelled) {
          setError(e)
          setLoading(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return { conn, loading, error }
}
