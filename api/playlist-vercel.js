// Vercel Serverless Function for IPTV URL Rewriting
import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "../src/lb-mapping.js";

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Handle GET /api/playlist
  const start = Date.now();
  const playlistUrl = req.query.url;
  const customDomain = req.query.customDomain;

  if (!playlistUrl) {
    return res.status(200).send(
      `#EXTM3U\n#EXTINF:-1,IPTV Playlist Rewriter URL Interceptor (Vercel Serverless)\n` +
      `#DESCRIPTION: Provide a playlist URL using ?url=<IPTV_M3U_URL>&customDomain=<YOUR_SUBDOMAIN>\n` +
      `https://${req.headers.host}/api/playlist?url=http://${DEFAULT_MAIN_SERVER_IP}/get.php?username=XXX&password=XXX`
    );
  }

  try {
    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    const headers = {
      "User-Agent": userAgent.includes("iptv") || userAgent.includes("vlc") 
        ? req.headers["user-agent"]
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    if (req.headers["accept"]) headers["Accept"] = req.headers["accept"];

    const response = await fetch(playlistUrl, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch original playlist. Status: ${response.status}`);
    }

    const originalContent = await response.text();
    let rewritten = originalContent;
    let replacementTotal = 0;

    for (const [ip, defaultSub] of Object.entries(INITIAL_MAPPINGS)) {
      let replacement = defaultSub;
      if (customDomain && customDomain.trim() !== "") {
        const prefix = defaultSub.split(".")[0];
        replacement = `${prefix}.${customDomain.trim()}`;
      }

      const escapedIp = ip.replace(/\./g, "\\.");
      const matches = (originalContent.match(new RegExp(escapedIp, "g")) || []).length;
      if (matches > 0) {
        replacementTotal += matches;
        
        // Replace IP:8080 first
        rewritten = rewritten.split(`${ip}:8080`).join(replacement);
        // Replace raw IP as fallback
        rewritten = rewritten.split(ip).join(replacement);
        
        // Strip any trailing load-balancer ports (like lbX.hdsj.store:8080)
        const portRegex = new RegExp(`${replacement.replace(/\./g, "\\.")}:\\d+`, "g");
        rewritten = rewritten.replace(portRegex, replacement);
      }
    }

    const elapsedMs = Date.now() - start;

    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="playlist_rewritten.m3u"`);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Rewritten-Count", replacementTotal.toString());
    res.setHeader("X-Rewritten-Time-Ms", elapsedMs.toString());

    return res.status(200).send(rewritten);
  } catch (error) {
    console.error("Rewrite error:", error);
    res.setHeader("Content-Type", "text/plain");
    return res.status(502).send(
      `#EXTM3U\n#EXTINF:-1,IPTV Rewriter Error (Vercel Node.js Serverless)\n` +
      `#ERROR: ${error.message || "Unknown proxy transmission issue"}\n` +
      `#ORIGINAL PLAYLIST SOURCE: ${playlistUrl}`
    );
  }
}
