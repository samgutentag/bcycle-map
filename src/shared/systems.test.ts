import { describe, it, expect } from 'vitest'
import { getSystems, getSystem } from './systems'

describe('getSystems', () => {
  it('returns the configured systems', () => {
    const systems = getSystems()
    expect(systems.length).toBeGreaterThan(0)
    expect(systems[0]!.system_id).toBe('bcycle_santabarbara')
  })

  it('excludes systems flagged enabled: false', () => {
    const ids = getSystems().map(s => s.system_id)
    expect(ids).not.toContain('bcycle_cincyredbike')
  })
})

describe('getSystem', () => {
  it('returns the system by id', () => {
    const s = getSystem('bcycle_santabarbara')
    expect(s).toBeDefined()
    expect(s!.gbfs_url).toMatch(/bcycle_santabarbara/)
  })

  it('returns undefined for unknown id', () => {
    expect(getSystem('not_a_system')).toBeUndefined()
  })

  it('still resolves a disabled system by id', () => {
    const s = getSystem('bcycle_cincyredbike')
    expect(s).toBeDefined()
    expect(s!.enabled).toBe(false)
  })
})
