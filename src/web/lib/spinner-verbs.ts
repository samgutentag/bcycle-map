import { useMemo } from 'react'

export const BIKE_VERBS: string[] = [
  'Pedaling…',
  'Coasting…',
  'Drafting…',
  'Spinning up…',
  'Shifting gears…',
  'Cresting…',
  'Tucking…',
  'Climbing…',
  'Descending…',
  'Bunny-hopping…',
  'Track-standing…',
  'Tailwinding…',
  'Bonking…',
  'Carbo-loading…',
  'Wrenching…',
  'Truing the wheel…',
  'Lubing the chain…',
  'Clipping in…',
  'Unclipping…',
  'Mashing…',
  'Cadencing…',
  'Bridging the gap…',
  'Breaking away…',
  'Pace-lining…',
  'Supertucking…',
  'Headwinding…',
  'Switchbacking…',
  'Pothole-dodging…',
  'Docking…',
  'Undocking…',
  'Gravel-grinding…',
  'Pumping tires…',
  'Patching the tube…',
  'Half-wheeling…',
  'Bombing the descent…',
  'Granny-gearing…',
  'Big-ringing…',
  'Echeloning…',
  'Hammering…',
  'Wheelying…',
]

export function getRandomVerb(): string {
  return BIKE_VERBS[Math.floor(Math.random() * BIKE_VERBS.length)]!
}

export function useStableVerb(): string {
  return useMemo(() => getRandomVerb(), [])
}
