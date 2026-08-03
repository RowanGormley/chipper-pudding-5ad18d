// Vercel serverless function. Calls Claude's text API with web search
// enabled to pick and describe genuinely good, current places — not
// restricted to a pre-fetched map-data candidate list (that approach kept
// missing well-known attractions depending on how they happened to be
// tagged in OpenStreetMap, and had no access to real opening-hours/status
// info). Runs server-side only, so the ANTHROPIC_API_KEY environment
// variable is never exposed to the browser. See api/identify.js for the
// sibling endpoint that handles the camera scan.
//
// A plain (non-search) request with a full candidate list previously
// measured at ~8s, close enough to Vercel's 10s default function timeout
// that it was intermittently getting killed mid-flight. Web search adds
// further round-trips on top of that, so the ceiling is raised well past
// both.
export const config = { maxDuration: 60 };

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
        // Search queries and tool results also count against max_tokens
        // when web_search is enabled, on top of the actual JSON answer —
        // 1500 wasn't enough headroom and was silently truncating the
        // final response mid-JSON.
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
        // Vercel's free plan hard-caps function duration at 60s (see
        // maxDuration above) and a real request measured at ~37s with up to
        // 5 searches allowed - occasionally over 60s and getting killed by
        // the platform, silently tipping into the fallback. Capping at 3
        // trades a little research depth for staying reliably under that
        // ceiling; there's no further headroom to buy without a paid plan.
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text();
      res.status(502).json({ error: "AI request failed", detail });
      return;
    }

    const data = await anthropicRes.json();
    // With web search enabled, content can include tool_use/tool_result/
    // server_tool_use blocks interleaved with the final answer — only the
    // actual text blocks are the response we want.
    const raw = (data.content || []).filter(b => b.type === "text").map(b => b.text || "").join("");
    res.status(200).json({ raw });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err) });
  }
}
