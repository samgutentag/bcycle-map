import { describe, it, expect } from 'vitest'
import type { BeaconEvent } from '../hooks/useInsights'
import { topPages, topRoutePairs, topStations, topActions, pageviews, interactions, filterToWindow } from './insights-agg'

function pv(path: string, ts = 1000): BeaconEvent {
  return { ts, type: 'pageview', path, name: null, props: null, referrer: null, country: null, session: 's', viewport: null }
}
function ev(name: string, props: Record<string, string>, ts = 1000): BeaconEvent {
  return { ts, type: 'event', path: '/', name, props, referrer: null, country: null, session: 's', viewport: null }
}

describe('insights-agg', () => {
  const events: BeaconEvent[] = [
    pv('/'), pv('/'), pv('/route/a/b'), pv('/station/x/details'),
    ev('route_check_run', { from: 'a', to: 'b', fromName: 'State St', toName: 'Beach' }),
    ev('route_check_run', { from: 'a', to: 'b', fromName: 'State St', toName: 'Beach' }),
    ev('route_check_run', { from: 'c', to: 'd', fromName: 'Funk Zone', toName: 'Harbor' }),
    ev('station_opened', { stationId: 'x', stationName: 'State & Cota', source: 'pin' }),
    ev('station_opened', { stationId: 'x', stationName: 'State & Cota', source: 'details' }),
    ev('flow_used', { action: 'scrub' }),
    ev('share_link', { kind: 'route' }),
  ]

  it('splits pageviews from interactions', () => {
    expect(pageviews(events)).toHaveLength(4)
    expect(interactions(events)).toHaveLength(7)
  })

  it('topPages groups pageviews by friendly name', () => {
    const pages = topPages(events, 10)
    expect(pages[0]).toEqual(['Live map', 2])
    expect(pages.map(([k]) => k)).toContain('Route planner')
    expect(pages.map(([k]) => k)).toContain('Station details')
  })

  it('topRoutePairs uses human names and counts by pair', () => {
    const pairs = topRoutePairs(events, 10)
    expect(pairs[0]).toEqual(['State St → Beach', 2])
    expect(pairs[1]).toEqual(['Funk Zone → Harbor', 1])
  })

  it('topStations groups by station name', () => {
    expect(topStations(events, 10)[0]).toEqual(['State & Cota', 2])
  })

  it('topActions counts every interaction by name', () => {
    const actions = Object.fromEntries(topActions(events, 10))
    expect(actions['route_check_run']).toBe(3)
    expect(actions['station_opened']).toBe(2)
    expect(actions['flow_used']).toBe(1)
    expect(actions['share_link']).toBe(1)
  })

  it('filterToWindow drops events older than the cutoff', () => {
    const now = 100_000
    const mixed = [pv('/', now - 10), pv('/', now - 5 * 86400)]
    expect(filterToWindow(mixed, 1, now)).toHaveLength(1)
  })
})
