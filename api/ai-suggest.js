// Proxies the "suggest category" feature to Anthropic's API, keeping the
// API key server-side. The browser only ever talks to this endpoint.
import { getSession } from "../lib/auth.js";

const TXN_TYPES = ["expense", "income", "transfer", "refund", "debt"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!getSession(req)) {
    return res.status(401).json({ error: "Sign in required." });
  }

  const { description, categories } = req.body || {};
  if (!description || typeof description !== "string") {
    return res.status(400).json({ error: "Missing description" });
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: "Missing categories" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: "AI suggestions aren't configured on this deployment (missing ANTHROPIC_API_KEY)." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 150,
        messages: [{
          role: "user",
          content: `Transaction description: "${description}". Categories available: ${categories.join(", ")}. Types available: ${TXN_TYPES.join(", ")}. Respond with ONLY raw JSON, no markdown: {"category": string, "type": string, "tags": [string, string]}`,
        }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("Anthropic API error:", upstream.status, detail);
      return res.status(502).json({ error: "AI suggestion service returned an error." });
    }

    const data = await upstream.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!categories.includes(parsed.category)) delete parsed.category;
    if (!TXN_TYPES.includes(parsed.type)) delete parsed.type;

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("api/ai-suggest error:", err);
    return res.status(500).json({ error: "Couldn't get an AI suggestion right now." });
  }
}
