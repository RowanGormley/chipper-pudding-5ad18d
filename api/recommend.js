// Vercel serverless function. Calls Claude's text API to pick and describe
// the most interesting candidate places. Runs server-side only, so the
// ANTHROPIC_API_KEY environment variable is never exposed to the browser.
// See api/identify.js for the sibling endpoint that handles the camera scan.
//
// A real request with a full candidate list measured at ~8s — close enough
// to Vercel's 10s default function timeout that it was intermittently
// getting killed mid-flight, silently tipping the app into its fallback
// text. maxDuration raises that ceiling explicitly.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing prompt" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text();
      res.status(502).json({ error: "AI request failed", detail });
      return;
    }

    const data = await anthropicRes.json();
    const raw = (data.content || []).map(b => b.text || "").join("");
    res.status(200).json({ raw });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err) });
  }
}
