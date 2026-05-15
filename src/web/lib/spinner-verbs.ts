import { useEffect, useState } from 'react'

const ROTATE_INTERVAL_MS = 3000

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

/**
 * Picks a verb on mount and rotates to a different one every 3 seconds.
 * Stable across React re-renders — only the interval drives changes.
 */
export function useStableVerb(): string {
  const [verb, setVerb] = useState<string>(() => getRandomVerb())
  useEffect(() => {
    const id = setInterval(() => {
      setVerb(prev => {
        if (BIKE_VERBS.length <= 1) return prev
        let next = getRandomVerb()
        while (next === prev) next = getRandomVerb()
        return next
      })
    }, ROTATE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
  return verb
}
