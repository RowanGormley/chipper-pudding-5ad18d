// Vercel serverless function. Runs on the server, not in the browser, so
// the ANTHROPIC_API_KEY environment variable it reads is never exposed to
// visitors. The app's frontend (app.jsx) POSTs a captured photo here;
// this forwards it to Claude's vision API and relays the parsed result back.
//
// Setup: in the Vercel project dashboard, go to Settings -> Environment
// Variables and add ANTHROPIC_API_KEY with a key from console.anthropic.com.
//
// Vision calls can run close to Vercel's 10s default function timeout;
// raise the ceiling explicitly rather than risk it getting killed mid-flight.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { imageDataUrl, location } = req.body || {};
  if (!imageDataUrl || typeof imageDataUrl !== "string") {
    res.status(400).json({ error: "Missing imageDataUrl" });
    return;
  }
  const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: "imageDataUrl must be a base64 data URL" });
    return;
  }
  const [, mediaType, base64Data] = match;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  const prompt = `You are a knowledgeable local guide. Look at this photo${location ? ` taken near ${location}` : ""} and identify what's shown — a building, landmark, dish, sign, statue, or other point of interest. Be as specific as you genuinely can (name it if you recognize it), but if you can't pin down exactly what it is, still describe what you can see (architectural style, apparent age, type of object) rather than refusing. Reply with ONLY JSON, no markdown fences: {"title":"what it is, as specific as you can tell","type":"short category label, e.g. an era or type","blurb":"2 warm, informative sentences about it","facts":["3 short interesting facts"]}`;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5", // vision-capable Claude model

        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text();
      res.status(502).json({ error: "AI request failed", detail });
      return;
    }

    const data = await anthropicRes.json();
    const raw = (data.content || []).map(b => b.text || "").join("");
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err) });
  }
}
