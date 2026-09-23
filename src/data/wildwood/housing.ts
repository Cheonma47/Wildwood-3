/**
 * Work & Travel housing marker.
 *
 * When your housing address is known, put its real coordinates here
 * (or enter them in-game: ESC → Settings → Housing). The in-game value is
 * stored in localStorage and overrides this default.
 *
 *   houseLatitude:  e.g. 38.98712
 *   houseLongitude: e.g. -74.82105
 *
 * Tip: right-click the building in Google Maps / OpenStreetMap to copy its
 * latitude and longitude.
 */
export const HOUSING_DEFAULT: { houseLatitude: number | null; houseLongitude: number | null; label: string } = {
  houseLatitude: null,
  houseLongitude: null,
  label: 'My W&T Housing',
};
