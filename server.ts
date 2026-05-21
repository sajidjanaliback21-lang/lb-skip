import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "./src/lb-mapping.js";

dotenv.config();

const app = express();
const PORT = 3000;

// Memory storage for live monitoring, statistics and analytics
interface RealtimeStats {
  totalRequests: number;
  totalBytesProcessed: number;
  activeMappingsCount: number;
  ipHits: { [ip: string]: number };
  recentRewrites: Array<{
    id: string;
    timestamp: string;
    sourceUrl: string;
    customDomain: string;
    elapsedMs: number;
    replacements: number;
    originalSize: number;
    rewrittenSize: number;
  }>;
}

const stats: RealtimeStats = {
  totalRequests: 0,
  totalBytesProcessed: 0,
  activeMappingsCount: Object.keys(INITIAL_MAPPINGS).length,
  ipHits: Object.keys(INITIAL_MAPPINGS).reduce((acc, ip) => {
    acc[ip] = 0;
    return acc;
  }, {} as { [ip: string]: number }),
  recentRewrites: [],
};

// Express configuration
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// CORS headers for IPTV player accessibility
app.all("*", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, User-Agent");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// GET /api/stats - Live performance metrics
app.get("/api/stats", (req, res) => {
  res.json({
    ...stats,
    activeMappings: INITIAL_MAPPINGS,
    defaultServer: DEFAULT_MAIN_SERVER_IP,
  });
});

// POST /api/rewrite-raw - Interactive paste-and-convert handler
app.post("/api/rewrite-raw", (req, res) => {
  try {
    const { content, customDomain, Mappings } = req.body;
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "No playlist content code provided to rewrite" });
    }

    const start = Date.now();
    const mappingsToUse = Mappings || INITIAL_MAPPINGS;
    let rewritten = content;
    let occurrencesCount = 0;
    const detectedIpsHits: { [ip: string]: number } = {};

    // Do the replacements
    for (const [ip, defaultSub] of Object.entries(mappingsToUse)) {
      const subStr = defaultSub as string;
      let replacement = subStr;
      if (customDomain && typeof customDomain === "string" && customDomain.trim() !== "") {
        const prefix = subStr.split(".")[0];
        replacement = `${prefix}.${customDomain.trim()}`;
      }

      // Count matches first
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

    return res.json({
      success: true,
      originalSize: content.length,
      rewrittenSize: rewritten.length,
      replacements: occurrencesCount,
      detectedIpsHits,
      elapsedMs,
      rewrittenContent: rewritten,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Internal rewriting failure" });
  }
});

// GET /playlist /api/playlist - Proxies the requested M3U8 & processes matches dynamically
// Supports /playlist.m3u8, /playlist.m3u, or /api/playlist endpoints for player compatibility
const handlePlaylistRewrite = async (req: express.Request, res: express.Response) => {
  const start = Date.now();
  const playlistUrl = req.query.url as string;
  const customDomain = req.query.customDomain as string;

  if (!playlistUrl) {
    return res.status(400).send(
      `#EXTM3U\n#EXTINF:-1,IPTV Playlist Rewriter URL Interceptor\n` +
      `#DESCRIPTION: Provide full playlist url to proxy and rewrite. Use ?url=<YOUR_RAW_IPTV_M3U_URL>&customDomain=<YOUR_SUBDOMAIN>\n` +
      `https://${req.hostname}/api/playlist?url=http://${DEFAULT_MAIN_SERVER_IP}/get.php?username=XXX&password=XXX`
    );
  }

  try {
    // Standard Player Emulated user-agent to bypass safety checks on mainstream stream providers
    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    const headers: { [key: string]: string } = {
      "User-Agent": userAgent.includes("iptv") || userAgent.includes("vlc") 
        ? req.headers["user-agent"] as string
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    // Forwarding specific authorization headers or content-type preferences if proxying
    if (req.headers["accept"]) headers["Accept"] = req.headers["accept"] as string;

    const response = await fetch(playlistUrl, { headers, method: "GET" });

    if (!response.ok) {
      throw new Error(`Failed to fetch original playlist from mainstream server. Status: ${response.status}`);
    }

    const originalContent = await response.text();
    let rewritten = originalContent;
    let replacementTotal = 0;

    // Execute matching replace operations
    for (const [ip, defaultSub] of Object.entries(INITIAL_MAPPINGS)) {
      let replacement = defaultSub;
      if (customDomain && customDomain.trim() !== "") {
        const prefix = defaultSub.split(".")[0];
        replacement = `${prefix}.${customDomain.trim()}`;
      }

      // Track hit
      const escapedIp = ip.replace(/\./g, "\\.");
      const matches = (originalContent.match(new RegExp(escapedIp, "g")) || []).length;
      if (matches > 0) {
        replacementTotal += matches;
        stats.ipHits[ip] = (stats.ipHits[ip] || 0) + matches;
        rewritten = rewritten.split(ip).join(replacement);
      }
    }

    const elapsedMs = Date.now() - start;

    // Track state metrics
    stats.totalRequests += 1;
    stats.totalBytesProcessed += originalContent.length;
    stats.recentRewrites.unshift({
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString(),
      sourceUrl: playlistUrl,
      customDomain: customDomain || "Default Domain",
      elapsedMs,
      replacements: replacementTotal,
      originalSize: originalContent.length,
      rewrittenSize: rewritten.length,
    });

    if (stats.recentRewrites.length > 30) {
      stats.recentRewrites.pop();
    }

    // Set standard response headers so video players load it instantly without CORS blockades
    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="playlist_rewritten.m3u"`);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-Rewritten-Count", replacementTotal.toString());
    res.setHeader("X-Rewritten-Time-Ms", elapsedMs.toString());

    return res.status(200).send(rewritten);
  } catch (error: any) {
    console.error("Rewrite error:", error);
    res.setHeader("Content-Type", "text/plain");
    return res.status(502).send(
      `#EXTM3U\n#EXTINF:-1,IPTV Rewriter Error: Failed to fetch and process remote playlist\n` +
      `#ERROR: ${error?.message || "Unknown proxy transmission issue"}\n` +
      `#ORIGINAL PLAYLIST SOURCE: ${playlistUrl}`
    );
  }
};

// Route handlers for various players
app.get("/api/playlist", handlePlaylistRewrite);
app.get("/playlist", handlePlaylistRewrite);

// Serve Static Frontent Client assets
const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`IPTV Rewriter Middleware listening on http://0.0.0.0:${PORT}`);
  });
};

startServer();
