const crypto = require("crypto");

const MAX_PROMPT = 70000;

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseJSON(text) {
  const t = String(text || "").trim();
  const tries = [t, t.replace(/^```(?:json)?\s*|\s*```$/g, "")];
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i > -1 && j > i) tries.push(t.slice(i, j + 1));
  for (const c of tries) {
    try { const v = JSON.parse(c); if (v && typeof v === "object") return v; } catch (_) {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "server_not_configured" });

  const required = process.env.ACCESS_CODE;
  if (required) {
    const got = String(req.headers["x-access-code"] || "");
    if (!got) return res.status(401).json({ error: "access_code_required" });
    if (!safeEqual(got, required)) return res.status(401).json({ error: "invalid_access_code" });
  }

  const prompt = req.body && req.body.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "bad_request" });
  if (prompt.length > MAX_PROMPT) return res.status(413).json({ error: "prompt_too_large" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
    if (!r.ok) {
      console.error("anthropic_status", r.status);
      return res.status(502).json({ error: "upstream_error" });
    }
    const j = await r.json();
    const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const result = parseJSON(text);
    if (!result) return res.status(502).json({ error: "invalid_json" });
    return res.status(200).json({ result });
  } catch (e) {
    console.error("explain_error", e && e.message);
    return res.status(502).json({ error: "upstream_error" });
  }
};

module.exports.config = { maxDuration: 60 };
