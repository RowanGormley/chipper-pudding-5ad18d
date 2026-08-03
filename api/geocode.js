// Vercel serverless function. Relays Nominatim (OpenStreetMap) geocoding
// requests server-side, with a proper User-Agent — Nominatim's usage
// policy requires one identifying the application, and requests without
// it are liable to be rejected, the same class of issue already found
// with Overpass (see api/places.js). Also lets "search near" queries be
// scoped to a bounding box around a given point via bounded=1, so a
// place name doesn't accidentally match a same-named spot elsewhere.
export const config = { maxDuration: 20 };

// Real-world test against several of Claude's own genuine picks for
// Southwold (Alfred Corry Lifeboat Museum, Adnams Sole Bay Brewery,
// Southwold Beach and Huts) found Nominatim/OSM simply has no matching
// named entity at all for many ordinary local businesses/attractions,
// however well-known — its indexing leans toward addresses and
// administratively-tagged features, not "what a local would call this
// place." Google Places' business index is far broader (already relied
// on for exactly this reason for photos, see api/photo.js), so it's used
// here as a fallback when a named-place search comes back empty.
async function googleFallback(query, lat, lon) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];
  try {
    const bias = (typeof lat === "number" && typeof lon === "number") ? `&locationbias=circle:3000@${lat},${lon}` : "";
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=geometry,formatted_address&key=${apiKey}${bias}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    const candidate = (j.candidates || [])[0];
    const loc = candidate && candidate.geometry && candidate.geometry.location;
    if (!loc) return [];
    // Shaped like a Nominatim jsonv2 result so callers don't need to care
    // which source actually answered.
    return [{ lat: String(loc.lat), lon: String(loc.lng), display_name: candidate.formatted_address || query, address: {} }];
  } catch (e) {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { mode, query, lat, lon } = req.body || {};
  const headers = {
    "user-agent": "FunFinder/1.0 (personal walking-recommendations app; contact via GitHub RowanGormley)",
    "accept": "application/json",
  };

  try {
    let url;
    if (mode === "search") {
      if (!query || typeof query !== "string") { res.status(400).json({ error: "Missing query" }); return; }
      url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
      if (typeof lat === "number" && typeof lon === "number") {
        const d = 0.05; // ~5.5km box in each direction at UK latitudes
        url += `&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}&bounded=1`;
      }
    } else if (mode === "reverse") {
      if (typeof lat !== "number" || typeof lon !== "number") { res.status(400).json({ error: "Missing lat/lon" }); return; }
      url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${lat}&lon=${lon}`;
    } else {
      res.status(400).json({ error: "Invalid mode" });
      return;
    }

    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error("nominatim " + r.status);
    let j = await r.json();
    if (mode === "search" && Array.isArray(j) && !j.length) {
      j = await googleFallback(query, lat, lon);
    }
    res.status(200).json(j);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
