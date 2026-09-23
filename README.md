# Wildwood Walk

A browser-based, first-person **1:1 scale walking simulator of Wildwood, New Jersey**, built from
real OpenStreetMap data. It's meant as a virtual orientation tool for Work & Travel students:
learn the street layout, real walking distances and times, and the way from your workplace
(Dogtooth Bar & Grill) to the Boardwalk and beach before you arrive.

There's no combat, no missions and no score. You just walk.

```
npm install
npm run dev          # http://localhost:5173
npm test             # unit + world-model tests (includes the distance validation)
npm run build        # production build → dist/
```

Controls: **WASD** move · **mouse** look · **Shift** run · **C** toggle fast walk · **Space** small jump ·
**M** map · **F** interact · **T** next time-of-day preset · **Esc** settings · **F3** debug.

## Geographic accuracy (the top priority)

| Rule | How it's enforced |
| --- | --- |
| 1 game unit = 1 metre | Every coordinate is projected from WGS84 lat/lon to metres; nothing is scaled or moved. |
| Real positions | Roads, buildings, boardwalk, piers, beach, water and POIs come straight from OSM. Landmarks use their real OSM footprints. |
| Real walking speed | Walk 1.4 m/s, fast walk 2.0 m/s, run 4.5 m/s (`src/world/geo/distance.ts`). |
| Real walking times | Always computed as distance ÷ speed. Nothing is hard-coded. |
| Verified | `src/world/geo/distance.test.ts` compares Vincenty ellipsoidal distance with game-world distance. |

**Pipeline:**

```
OSM API (map tiles)  →  scripts/fetch-osm.mjs   →  data/osm-raw/*.osm  (not committed)
                     →  scripts/build-osm.mjs   →  public/data/wildwood/*.json  (lat/lon only)
runtime: src/world/geo/projection.ts  latLonToWorld()  →  local metres (x = east, z = south)
         → roads / sidewalks / terrain raster / buildings / boardwalk / walkable surfaces
         → landmark registry replaces matching OSM footprints with custom models
```

**Projection:** local equidistant-meridian projection on the WGS84 ellipsoid, centred at
38.985°N 74.815°W. North–south distances use the exact meridian arc length and east–west distances
use the exact parallel radius. Helpers: `latLonToWorld(lat, lon)`, `worldToLatLon(x, z)`,
`distanceMeters(a, b)`, `geodesicDistance(a, b)`.

**Validation results** (from `npm test`, Vincenty vs game world):

| Pair | Real | Game | Error |
| --- | --- | --- | --- |
| Dogtooth → McDonald's | 357.92 m | 357.90 m | 0.005 % |
| Dogtooth → Boardwalk (Taylor Ave) | 583.84 m | 583.81 m | 0.004 % |
| Dogtooth → Convention Center | 733.05 m | 733.04 m | 0.002 % |
| Dogtooth → Morey's Mariner's Pier | 1254.75 m | 1254.75 m | 0.0003 % |
| McDonald's → Morey's Surfside Pier | 2182.86 m | 2182.86 m | < 0.0001 % |
| Whole study area corner to corner | ≈ 6.3 km | – | < 0.05 % |

The target was < 2 %. Walking Dogtooth → Boardwalk along the real streets is **653 m, about 8 minutes**.

In game you can check this yourself: open the map (**M**) → **Measure** → click two points to see
the real geographic distance, the game-world distance, the difference and the scale error. There's also
a table of fixed landmark pairs.

## What's implemented

- **Data:** 1,179 OSM roads, 773 real building footprints, 371 land-use areas (beach, boardwalk,
  piers, parks, parking, wetlands), the coastline turned into water polygons, 432 POIs, trees,
  signals and utility poles.
- **World:** 250 m chunk streaming with a time-sliced builder. Nearby chunks get full detail and
  far chunks get plain materials and no props. A coarse 32 m terrain fills in while chunks load,
  and distant chunks unload. Draw distance is adjustable.
- **Terrain:** raster built from the real coastline, beaches and wetlands. The beach slopes into
  the ocean and the famously wide beach keeps its real width.
- **Roads:** real carriageway widths, sidewalks, double-yellow centre lines, parking-lane lines,
  crosswalks at OSM crossings and signals, and street-name signs at real intersections.
- **Buildings:** real OSM footprints, plus **procedural fill** on the real block frontage (houses,
  motels, apartments, shops, and a continuous shop row along the Boardwalk). Fill buildings never
  overlap real buildings, roads, sidewalks, beach, parks or parking. They're marked as approximate on the map.
- **Boardwalk:** the real OSM Boardwalk polygon as an elevated deck, 1 m up on pilings, with plank
  texture, tram-lane lines, lamps, benches, trash cans, ramps where every street meets it, beach
  stairs, and the **Sightseer Tram Car** running end to end.
- **Beach and ocean:** sand, lifeguard stands, umbrellas, chairs, beach visitors, and an animated
  water shader with surf foam that follows the real shoreline.
- **Landmarks** (registry in `src/data/wildwood/landmarks.ts`): **Dogtooth Bar & Grill** (real
  footprint, signage, entrance, awning), **McDonald's** (real footprint, pylon sign),
  **Wildwoods Convention Center**, **Morey's Piers** (Mariner's, Adventure and Surfside on their
  real pier polygons, with the Ferris wheel, coasters, drop tower, carousel and swing ride), and the
  WILDWOODS beach sign.
- **Player:** first-person controller with gravity, jump, 0.45 m step-up for curbs, ramps and
  stairs, circle-vs-wall building collision, ocean wading limit, head bob and footsteps that change by surface.
- **Map (M):** full vector map of real Wildwood with pan and zoom, street labels, landmarks, your
  position and heading, and click-to-select. It shows the walking route (A* on the real street
  graph plus the Boardwalk centreline), the straight-line distance, and walking, fast-walk and run
  times. **Set destination** draws the route in the world with a beacon. It never teleports you.
- **WAT Mode:** toggleable categories (workplace, housing, supermarkets, convenience, pharmacies,
  laundromats, bus stops, cheap food, ATM/banks, boardwalk, beach) taken from OSM.
- **Housing marker:** enter `houseLatitude` / `houseLongitude` in **Esc → Settings**, or drop a pin
  on the map. You get a green beacon at the exact spot and routes from home to anywhere. The default
  can also go in `src/data/wildwood/housing.ts`.
- **Day/night:** morning, afternoon, sunset, evening and night presets, plus an optional running
  clock. The sun position is computed for Wildwood in July. At night windows, street and Boardwalk
  lamps, ride lights, neon signs and the Ferris wheel light up. Bloom (night glow) is optional in settings.
- **Audio:** everything is synthesised in the browser, with no recordings or songs. Surf, wind,
  gulls, crowd murmur, arcade blips, birds and distant traffic cross-fade by zone.
- **No moving cars or people** (removed for performance). Static parked cars, beach umbrellas
  and street furniture remain near the player.
- **Signage:** real OSM business names go on their buildings. Motels get Doo-Wop pole signs with
  neon at night. Boardwalk shops without OSM data get generic category signs (PIZZA, ARCADE, …)
  instead of invented names.
- **Debug (F3):** latitude and longitude, world X and Z, speed, distance from Dogtooth, current
  street, surface, FPS, loaded chunks, draw calls, triangles and building counts.

## Project structure

```
scripts/                 OSM download + preprocessing (Node)
public/data/wildwood/    preprocessed OSM (lat/lon JSON, ODbL)
src/
  data/wildwood/         landmark registry, spawn point, housing config
  world/
    geo/                 projection.ts, distance.ts, coordinates.ts (+ tests)
    data/                typed loaders (projects lat/lon → metres)
    math/                polygons, spatial grid, segment index
    terrain/             raster heightfield + chunk meshes
    roads/               widths/classes, ribbons, sidewalks, markings
    buildings/           OSM classifier, procedural fill, merged chunk meshes
    boardwalk/           deck, centreline, ramps, tram lane
    ocean/               water shader
    landmarks/           Dogtooth, McDonald's, Convention Center, Morey's Piers…
    props/               instanced prop prototypes, lamp light pool
    physics/             walkable surfaces (deck/ramps/stairs), wall colliders
    render/              shared materials, procedural textures, geometry builder
    worldModel.ts        builds everything from the data
  player/                FirstPersonController.tsx, PlayerPhysics.ts
  systems/
    chunks/              chunk index + streaming manager (LOD)
    time/                sun position, sky/lighting, bloom
    traffic/             cars, tram car
    pedestrians/
    audio/               procedural ambient audio
    navigation/          routing graph (A*), route line, interaction
  ui/                    hud/, map/, settings/, debug/
  store/                 Zustand game state
```

## Updating the map data

```
npm run osm:fetch    # downloads 20 OSM API tiles for the bounds in scripts/bounds.mjs
npm run osm:build    # regenerates public/data/wildwood/*.json
```

## Known limitations

- **Building coverage:** OSM has footprints for only about 770 buildings here. The other ~8,000
  are procedural. They sit on real blocks and real frontage, but their shapes, heights and uses are
  approximate. Real footprints are drawn darker on the map.
- **Landmark appearance:** positions and footprints are real. Colours, signage and ride layouts are
  stylised approximations. The Dogtooth exterior in particular should be refined from photos. The
  WILDWOODS sign position is approximate because it isn't in OSM.
- **Terrain:** dry land is flat at 0 m. That's close to reality, but dunes aren't modelled. The
  Boardwalk deck height (1 m) and ramp and stair placement are approximations.
- **Routing:** it uses OSM street and footway geometry and doesn't know about closed paths, fences
  or crossing rules. The Boardwalk route uses a derived centreline.
- **Traffic:** vehicles only turn at OSM way endpoints, so some intersections are driven straight through.
- **Interiors** aren't modelled. The simulator is exterior-only.
- Tested with headless Chromium using SwiftShader software rendering, so FPS numbers there don't
  reflect real GPUs. JavaScript timings from that run: world build ≈ 3 s at load, a chunk takes
  ≈ 2 ms (base) and ≈ 1 ms (detail) to build, and a typical view is ≈ 360k triangles and ≈ 380
  draw calls.

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).
