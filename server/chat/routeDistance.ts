/** Approximate straight-line distance to Google's route polyline, NOT driving detour/access. */
export function distanceFromRouteMeters(encoded: string, point: { latitude: number; longitude: number }): number | null {
  const points: Array<[number, number]> = [];
  let index = 0, lat = 0, lng = 0;
  function delta() {
    let value = 0, shift = 0;
    for (let count = 0; count < 7; count++) {
      if (index >= encoded.length) throw Error("Invalid polyline");
      const b = encoded.charCodeAt(index++) - 63;
      if (b < 0 || b > 63) throw Error("Invalid polyline");
      value |= (b & 31) << shift; shift += 5;
      if (b < 32) return (value & 1) ? ~(value >> 1) : value >> 1;
    }
    throw Error("Invalid polyline");
  }
  try {
    if (encoded.length > 200000) return null;
    while (index < encoded.length) { lat += delta(); lng += delta(); points.push([lat / 1e5, lng / 1e5]); }
    if (points.length < 2) return null;
    const scaleY = Math.PI * 6371000 / 180, scaleX = scaleY * Math.cos(point.latitude * Math.PI / 180);
    let min = Infinity;
    for (let i = 1; i < points.length; i++) {
      const ax = (points[i-1][1] - point.longitude) * scaleX, ay = (points[i-1][0] - point.latitude) * scaleY;
      const bx = (points[i][1] - point.longitude) * scaleX, by = (points[i][0] - point.latitude) * scaleY;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return Number.isFinite(min) ? Math.round(min) : null;
  } catch { return null; }
}
