// Which present-day country a place lies in: an offline point-in-polygon
// over Natural Earth admin-0 boundaries (public domain, via world-atlas).
// No imports from the museum, so the build script can run it under Node.
import type { Feature, Geometry, Position } from 'geojson';

/** Natural Earth admin-0 units that are not countries: Antarctica. */
const NOT_COUNTRIES = new Set(['010']);

/** How far off a coast a place may lie and still count for that country. */
export const COAST_KM = 30;

export type CountryFeature = Feature<Geometry, { name?: string }> & { id?: string | number };

const R = 6371;
const rad = Math.PI / 180;

/** Distance in km from a point to a segment, on a local flat projection. */
function segmentKm(p: Position, a: Position, b: Position): number {
  const k = Math.cos(p[1] * rad);
  // Longitudes relative to the point, the segment kept whole across ±180.
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  const a0 = wrap(a[0] - p[0]);
  const ax = a0 * k;
  const ay = a[1] - p[1];
  const bx = (a0 + wrap(b[0] - a[0])) * k;
  const by = b[1] - p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * rad * R;
}

function rings(g: Geometry): Position[][] {
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}

/**
 * Planar even-odd test over all rings. (d3's spherical geoContains reads a
 * few small rings of the 1:50m data as "the whole globe but this island".)
 */
export function contains(f: CountryFeature, lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of rings(f.geometry)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distance in km from a lon/lat to a country's outline (0 inside). */
export function distanceKm(f: CountryFeature, lon: number, lat: number): number {
  if (contains(f, lon, lat)) return 0;
  let best = Infinity;
  for (const ring of rings(f.geometry)) {
    for (let i = 1; i < ring.length; i++) {
      // Skip segments far away before the exact measure.
      const a = ring[i - 1];
      if (Math.abs(a[1] - lat) > 3 && Math.abs(ring[i][1] - lat) > 3) continue;
      best = Math.min(best, segmentKm([lon, lat], a, ring[i]));
    }
  }
  return best;
}

/**
 * The country a place lies in: the polygon that contains it, else the
 * nearest one within COAST_KM (harbours and islands the coarse coastline
 * misses). Places at sea, at the poles or "the Atlantic" get none.
 */
export function countryAt(features: CountryFeature[], lon: number, lat: number): CountryFeature | undefined {
  let best: CountryFeature | undefined;
  let bestD = COAST_KM;
  for (const f of features) {
    if (NOT_COUNTRIES.has(isoOf(f))) continue;
    const d = distanceKm(f, lon, lat);
    if (d === 0) return f;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export const isoOf = (f: CountryFeature): string => String(f.id ?? f.properties?.name ?? '');

/**
 * What content/countries.yaml says about one place before the map is asked:
 * an ISO id, null for "no country", undefined to use the map.
 */
export type Pin = (index: number, place: { name?: string; lat: number; lon: number }) => string | null | undefined;

/**
 * Every country a card's places lie in, keyed by ISO id, with the indexes of
 * the card's places there. A card counts for each country any of its places
 * lies in; the main place's country comes first.
 */
export function assignCard(features: CountryFeature[], places: { name?: string; lat: number; lon: number }[], pin?: Pin): Map<string, number[]> {
  const out = new Map<string, number[]>();
  places.forEach((p, i) => {
    const pinned = pin?.(i, p);
    const iso = pinned === undefined ? (() => {
      const f = countryAt(features, p.lon, p.lat);
      return f ? isoOf(f) : null;
    })() : pinned;
    if (!iso) return;
    out.set(iso, [...(out.get(iso) ?? []), i]);
  });
  return out;
}
