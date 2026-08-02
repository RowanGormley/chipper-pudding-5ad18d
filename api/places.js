// Vercel serverless function. Relays an Overpass QL query to whichever of
// several public Overpass mirrors answers first, server-side.
//
// This used to be called directly from the browser, but failures reported
// from a real phone couldn't be reproduced or diagnosed from here — direct
// testing of the same mirrors from this machine kept succeeding. Moving the
// call server-to-server sidesteps whatever was going wrong on-device
// (carrier network quirks, standalone-web-app networking behavior, etc.)
// and, just as importantly, means any future failure can be reproduced and
// inspected by hitting this endpoint directly, instead of being invisible.

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { query } = req.body || {};
  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "Missing query" });
    return;
  }

  const attempt = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "accept": "application/json, */*",
          "user-agent": "FunFinder/1.0 (personal walking-recommendations app; contact via GitHub RowanGormley)",
        },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const json = await Promise.any(MIRRORS.map(attempt));
    res.status(200).json(json);
  } catch (e) {
    const detail = e && Array.isArray(e.errors) ? e.errors.map(String) : [String(e)];
    console.error("All Overpass mirrors failed:", detail);
    res.status(502).json({ error: "All Overpass mirrors failed", detail });
  }
}
