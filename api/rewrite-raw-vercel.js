// Vercel Serverless Function for IPTV URL Rewriting - Raw Content paste API
import { INITIAL_MAPPINGS } from "../src/lb-mapping.js";

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { content, customDomain, Mappings } = req.body;
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "No playlist content code provided to rewrite" });
    }

    const start = Date.now();
    const mappingsToUse = Mappings || INITIAL_MAPPINGS;
    let rewritten = content;
    let occurrencesCount = 0;
    const detectedIpsHits = {};

    for (const [ip, defaultSub] of Object.entries(mappingsToUse)) {
      let replacement = defaultSub;
      if (customDomain && typeof customDomain === "string" && customDomain.trim() !== "") {
        const prefix = defaultSub.split(".")[0];
        replacement = `${prefix}.${customDomain.trim()}`;
      }

      const escapedIp = ip.replace(/\./g, "\\.");
      const regex = new RegExp(escapedIp, "g");
      const matches = (content.match(regex) || []).length;
      if (matches > 0) {
        occurrencesCount += matches;
        detectedIpsHits[ip] = matches;
        rewritten = rewritten.split(ip).join(replacement);
      }
    }

    const elapsedMs = Date.now() - start;

    return res.status(200).json({
      success: true,
      originalSize: content.length,
      rewrittenSize: rewritten.length,
      replacements: occurrencesCount,
      detectedIpsHits,
      elapsedMs,
      rewrittenContent: rewritten,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Internal rewriting failure" });
  }
}
