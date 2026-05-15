/**
 * Decode a Google-encoded polyline into [lng, lat] coordinate pairs.
 * Output order is [lng, lat] so the result drops straight into a GeoJSON LineString.
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dLat = (result & 1) ? ~(result >> 1) : (result >> 1)
    lat += dLat

    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dLng = (result & 1) ? ~(result >> 1) : (result >> 1)
    lng += dLng

    out.push([lng / 1e5, lat / 1e5])
  }

  return out
}
