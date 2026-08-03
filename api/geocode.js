// Vercel serverless function. Relays Nominatim (OpenStreetMap) geocoding
// requests server-side, with a proper User-Agent — Nominatim's usage
// policy requires one identifying the application, and requests without
// it are liable to be rejected, the same class of issue already found
// with Overpass (see api/places.js). Also lets "search near" queries be
// scoped to a bounding box around a given point via bounded=1, so a
// place name doesn't accidentally match a same-named spot elsewhere.
export const config = { maxDuration: 15 };

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
    const j = await r.json();
    res.status(200).json(j);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
