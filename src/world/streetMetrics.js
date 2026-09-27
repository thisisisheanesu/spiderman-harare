// Shared street cross-section rules so the city renderer (roads, kerbs, markings), traffic (lanes)
// and pedestrians (sidewalks) all agree. Zimbabwe drives on the LEFT.
//
// A road record comes from data.roads: {cls, w, lanes, oneway, pts, …}. Directions are unit vectors
// (dx, dz) in the x/z plane (north = -z).

const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);

export const KERB_HEIGHT = 0.15;

export function isMajor(road) {
  return MAJOR.has(road.cls);
}

// Sidewalk width on each side of the carriageway (0 = no sidewalk, e.g. service lanes).
export function sidewalkWidth(road) {
  if (road.cls === 'service') return 0;
  if (road.link) return 0;
  if (MAJOR.has(road.cls)) return 3.5;
  return 2.4;
}

// Distance from the road centreline to the kerb (edge of carriageway).
export function kerbOffset(road) {
  return road.w / 2;
}

// Distance from the road centreline to the middle of the sidewalk.
export function sidewalkCenterOffset(road) {
  return road.w / 2 + sidewalkWidth(road) / 2;
}

// Total number of traffic lanes across the carriageway.
export function totalLanes(road) {
  const perDir = Math.max(1, road.lanes || 1);
  return road.oneway ? perDir : perDir * 2;
}

export function laneWidth(road) {
  return road.w / totalLanes(road);
}

// Left-hand perpendicular of a travel direction (dx, dz): facing north (0,-1) → west (-1, 0).
export function leftOf(dx, dz) {
  return { x: dz, z: -dx };
}

// Signed offset from the centreline (positive = to the LEFT of the travel direction a→b… see below)
// for lane `laneIndex` (0 = kerbside lane) when travelling in `dirSign` (+1 = a→b along pts, -1 = b→a).
// Returns the offset measured to the left of the *travel* direction; multiply leftOf(travelDir) by it.
export function laneOffset(road, laneIndex = 0) {
  const lw = laneWidth(road);
  if (road.oneway) {
    // One-way: lanes fill the whole carriageway; lane 0 hugs the left kerb.
    const n = totalLanes(road);
    return (n / 2 - 0.5 - laneIndex) * lw;
  }
  // Two-way, keep left: lane 0 is the kerbside lane on the left half.
  const perDir = Math.max(1, road.lanes || 1);
  return (perDir - 0.5 - laneIndex) * lw;
}

// Whether travel from node a→b (dirSign +1) or b→a (dirSign -1) is allowed.
export function allowsDirection(road, dirSign) {
  if (!road.oneway) return true;
  return road.oneway === dirSign;
}
