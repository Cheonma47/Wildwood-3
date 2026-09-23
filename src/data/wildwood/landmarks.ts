/**
 * Landmark registry.
 *
 * Every landmark is placed from its real latitude/longitude. When an OSM
 * building footprint matches `osmBuildingId`, the procedural building is
 * replaced by the custom landmark renderer named in `model`, which receives
 * the real footprint so the landmark stays geographically exact.
 *
 * Coordinates: OpenStreetMap (ODbL) building centroids unless noted.
 */

export type LandmarkModel =
  | 'dogtooth'
  | 'mcdonalds'
  | 'convention-center'
  | 'moreys-pier'
  | 'wildwoods-sign'
  | 'none';

export interface Landmark {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  category: 'workplace' | 'food' | 'venue' | 'amusement' | 'beach' | 'boardwalk' | 'housing' | 'landmark';
  /** OSM way/relation id of the real building footprint, if any. */
  osmBuildingId?: number;
  /** OSM relation/way id of an area (pier, theme park) if any. */
  osmAreaId?: number;
  model: LandmarkModel;
  /** Map priority: 1 = always shown with a large marker. */
  priority: 1 | 2 | 3;
  description?: string;
}

export const LANDMARKS: Landmark[] = [
  {
    id: 'dogtooth',
    name: 'Dogtooth Bar & Grill',
    address: '100 E Taylor Ave, Wildwood, NJ 08260',
    // OSM building way 499965678 (centroid). Corner of E Taylor Ave & New Jersey Ave.
    latitude: 38.984261,
    longitude: -74.82412,
    category: 'workplace',
    osmBuildingId: 499965678,
    model: 'dogtooth',
    priority: 1,
    description: 'Work & Travel workplace. Corner of East Taylor Avenue and New Jersey Avenue.',
  },
  {
    id: 'mcdonalds',
    name: "McDonald's",
    address: '4900 Park Blvd, Wildwood, NJ 08260',
    // OSM building way 427713180, corner of Park Blvd & Rio Grande Ave.
    latitude: 38.985992,
    longitude: -74.827605,
    category: 'food',
    osmBuildingId: 427713180,
    model: 'mcdonalds',
    priority: 1,
    description: 'Park Boulevard at Rio Grande Avenue.',
  },
  {
    id: 'convention-center',
    name: 'Wildwoods Convention Center',
    address: '4501 Boardwalk, Wildwood, NJ 08260',
    latitude: 38.98136,
    longitude: -74.81652,
    category: 'venue',
    osmBuildingId: 614113994,
    model: 'convention-center',
    priority: 1,
    description: 'On the Boardwalk at Burk Avenue.',
  },
  {
    id: 'moreys-mariners',
    name: "Morey's Piers – Mariner's Pier",
    address: '3501 Boardwalk, Wildwood, NJ 08260',
    // Centroid of OSM theme_park relation 11062795.
    latitude: 38.98605,
    longitude: -74.809821,
    category: 'amusement',
    osmAreaId: 11062795,
    model: 'moreys-pier',
    priority: 1,
    description: "Morey's Mariner's Pier at Schellenger Avenue – Ferris wheel and coasters.",
  },
  {
    id: 'moreys-adventure',
    name: "Morey's Piers – Adventure Pier",
    address: 'Spencer Ave & Boardwalk, Wildwood, NJ',
    latitude: 38.983822,
    longitude: -74.813689,
    category: 'amusement',
    osmAreaId: 230913077,
    model: 'moreys-pier',
    priority: 2,
  },
  {
    id: 'moreys-surfside',
    name: "Morey's Piers – Surfside Pier",
    address: '25th Ave & Boardwalk, North Wildwood, NJ',
    // Centroid of OSM theme_park relation 11062798.
    latitude: 38.989439,
    longitude: -74.802801,
    category: 'amusement',
    osmAreaId: 11062798,
    model: 'moreys-pier',
    priority: 2,
  },
  {
    id: 'boardwalk-taylor',
    name: 'Wildwood Boardwalk (Taylor Ave entrance)',
    // Point of the OSM Boardwalk polygon (relation 11063873) closest to the end of E Taylor Ave.
    latitude: 38.980607,
    longitude: -74.819274,
    category: 'boardwalk',
    model: 'none',
    priority: 1,
    description: 'Closest Boardwalk entrance to Dogtooth – straight down Taylor Avenue.',
  },
  {
    id: 'beach-taylor',
    name: 'Wildwood Beach (Taylor Ave)',
    latitude: 38.97915,
    longitude: -74.8168,
    category: 'beach',
    model: 'none',
    priority: 1,
    description: 'The famously wide beach. The ocean is still a long walk from here!',
  },
  {
    id: 'wildwoods-sign',
    name: 'WILDWOODS Beach Sign',
    // Approximate: on the beach in front of the Convention Center (not in OSM).
    latitude: 38.98085,
    longitude: -74.8152,
    category: 'landmark',
    model: 'wildwoods-sign',
    priority: 2,
    description: 'Big letter sign on the beach by the Convention Center (position approximate).',
  },
];

export function findLandmarkByBuilding(osmId: number): Landmark | undefined {
  return LANDMARKS.find((l) => l.osmBuildingId === osmId);
}

export const DOGTOOTH = LANDMARKS[0];

/**
 * Player spawn: across East Taylor Avenue from Dogtooth's Taylor-facing
 * facade (16 m out along the facade normal), looking at the building.
 * Given as lat/lon so it is projection-independent.
 */
export const SPAWN = { latitude: 38.98446, longitude: -74.823847, headingDeg: 227 };
