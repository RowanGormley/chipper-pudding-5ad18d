// Vercel serverless function. Looks up a photo for a named place via the
// Google Places API, server-side only, so GOOGLE_PLACES_API_KEY never
// reaches the browser. Used as a fallback for places without a Wikipedia
// page (see app.jsx's attachPhotos) since Google's coverage of ordinary
// local businesses is much broader.
//
// Setup: in the Vercel project dashboard, go to Settings -> Environment
// Variables and add GOOGLE_PLACES_API_KEY with a key from
// console.cloud.google.com that has the Places API enabled.
//
// Google's Place Photo endpoint responds with a 302 redirect to a plain
// googleusercontent.com image URL that itself needs no key. We follow that
// redirect server-side and hand the browser just that final URL, so the
// key is never exposed and the image itself loads directly from Google's
// CDN rather than being proxied through this function.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { name, lat, lon } = req.body || {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Missing name" });
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing GOOGLE_PLACES_API_KEY" });
    return;
  }

  try {
    const bias = (typeof lat === "number" && typeof lon === "number") ? `&locationbias=circle:2000@${lat},${lon}` : "";
    const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name)}&inputtype=textquery&fields=photos&key=${apiKey}${bias}`;
    const findRes = await fetch(findUrl);
    if (!findRes.ok) { res.status(200).json({ photo: null }); return; }
    const findJson = await findRes.json();
    const candidate = (findJson.candidates || [])[0];
    const photoRef = candidate && candidate.photos && candidate.photos[0] && candidate.photos[0].photo_reference;
    if (!photoRef) { res.status(200).json({ photo: null }); return; }

    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=640&photo_reference=${photoRef}&key=${apiKey}`;
    const photoRes = await fetch(photoUrl, { redirect: "manual" });
    const location = photoRes.headers.get("location");
    res.status(200).json({ photo: location || null });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err) });
  }
}
