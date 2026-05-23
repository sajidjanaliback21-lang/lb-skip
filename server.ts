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

// Xtream Codes transparent proxy and rewrite middleware
const handleXtreamProxy = async (req: express.Request, res: express.Response) => {
  const file = req.path.substring(1) || "player_api.php";
  const targetUrl = new URL(`http://${DEFAULT_MAIN_SERVER_IP}/${file}`);

  for (const [key, value] of Object.entries(req.query)) {
    targetUrl.searchParams.set(key, String(value));
  }

  const rawCustomDomain = (req.query.customDomain as string) || req.headers.host || "hdsj.store";
  let cleanDomain = rawCustomDomain;
  if (cleanDomain.includes(":")) {
    cleanDomain = cleanDomain.split(":")[0];
  }

  try {
    const forwardHeaders: { [key: string]: string } = {
      "User-Agent": (req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer") as string,
      "Accept": (req.headers["accept"] || "*/*") as string,
    };

    if (req.headers["authorization"]) {
      forwardHeaders["Authorization"] = req.headers["authorization"] as string;
    }

    const fetchOptions: any = {
      method: req.method,
      headers: forwardHeaders,
    };

    if (req.method === "POST" && req.body) {
      if (typeof req.body === "string") {
        fetchOptions.body = req.body;
        if (req.headers["content-type"]) {
          forwardHeaders["Content-Type"] = req.headers["content-type"] as string;
        }
      } else {
        const formParams = new URLSearchParams();
        for (const [k, v] of Object.entries(req.body)) {
          formParams.append(k, String(v));
        }
        fetchOptions.body = formParams.toString();
        forwardHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      }
    }

    const response = await fetch(targetUrl.toString(), fetchOptions);
    const contentType = response.headers.get("content-type") || "text/plain";

    const responseText = await response.text();
    let rewrittenText = responseText;
    let replacementCount = 0;

    for (const [ip, defaultSub] of Object.entries(INITIAL_MAPPINGS)) {
      const subStr = defaultSub as string;
      const prefix = subStr.split(".")[0];
      const replacement = `${prefix}.${cleanDomain}`;

      const escapedIp = ip.replace(/\./g, "\\.");
      const regex = new RegExp(escapedIp, "g");
      const matches = (responseText.match(regex) || []).length;

      if (matches > 0) {
        replacementCount += matches;
        rewrittenText = rewrittenText.split(ip).join(replacement);
      }
    }

    // Intercept server_info in JSON to force routing stream requests through Express
    if (rewrittenText.trim().startsWith("{")) {
      try {
        const obj = JSON.parse(rewrittenText);
        if (obj && obj.server_info) {
          obj.server_info.url = req.headers.host || "hdsj.store";
          let host = req.headers.host || "hdsj.store";
          if (host.includes(":")) {
            obj.server_info.port = host.split(":")[1];
            obj.server_info.server_protocol = "http";
          } else {
            obj.server_info.port = "443";
            obj.server_info.server_protocol = "https";
          }
          if (obj.server_info.https_port) {
            obj.server_info.https_port = "443";
          }
          rewrittenText = JSON.stringify(obj);
        }
      } catch (jsonErr) {
        console.error("Express local JSON server_info patch error:", jsonErr);
      }
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Replacement-Count", replacementCount.toString());
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    return res.status(response.status).send(rewrittenText);
  } catch (error: any) {
    console.error("Express Xtream Proxy fail:", error);
    return res.status(502).json({
      error: "Xtream proxy mapping failure",
      message: error.message || "Failed to reach main server."
    });
  }
};

app.all("/player_api.php", handleXtreamProxy);
app.all("/get.php", handleXtreamProxy);
app.all("/xmltv.php", handleXtreamProxy);

// Express stream wildcard redirect interceptor for /live/*, /movie/*, and /series/*
const handleStreamRedirect = async (req: express.Request, res: express.Response) => {
  const pathParts = req.path.split("/");
  // pathParts will look like ["", "live", "user", "pass", "123.ts"] or similar
  const streamType = pathParts[1]; // "live" | "movie" | "series"
  const streamPath = pathParts.slice(2).join("/");

  if (!streamType || !streamPath) {
    return res.status(400).send("Bad request parameters.");
  }

  const rawCustomDomain = (req.query.customDomain as string) || req.headers.host || "hdsj.store";
  let cleanDomain = rawCustomDomain;
  if (cleanDomain.includes(":")) {
    cleanDomain = cleanDomain.split(":")[0];
  }

  // Avoid Vercel / local cloud app subdomains for LBs
  if (cleanDomain.includes("vercel.app") || cleanDomain.includes("localhost") || cleanDomain.includes("run.app")) {
    cleanDomain = "hdsj.store";
  }

  const targetUrl = new URL(`http://${DEFAULT_MAIN_SERVER_IP}:8080/${streamType}/${streamPath}`);
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== "customDomain") {
      targetUrl.searchParams.set(key, String(value));
    }
  }

  // Parse and dynamically rewrite live TV MPEG-TS (.ts) streams to HLS (.m3u8) for maximum player compatibility
  if (targetUrl.pathname.startsWith("/live/") && targetUrl.pathname.toLowerCase().endsWith(".ts")) {
    targetUrl.pathname = targetUrl.pathname.slice(0, -3) + ".m3u8";
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": (req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer") as string,
        "Accept": (req.headers["accept"] || "*/*") as string,
      },
      redirect: "manual"
    });

    const locationHeader = response.headers.get("location");

    if (locationHeader) {
      let rewrittenLocation = locationHeader;
      let replacementCount = 0;

      for (const [ip, defaultSub] of Object.entries(INITIAL_MAPPINGS)) {
        const subStr = defaultSub as string;
        const prefix = subStr.split(".")[0];
        const replacement = `${prefix}.${cleanDomain}`;

        if (rewrittenLocation.includes(ip)) {
          rewrittenLocation = rewrittenLocation.split(ip).join(replacement);
          replacementCount++;
        }
      }

      // Force HTTP protocol on port 8080 (LBs do not have SSL)
      if (rewrittenLocation.startsWith("https://")) {
        rewrittenLocation = "http://" + rewrittenLocation.substring(8);
      } else if (!rewrittenLocation.startsWith("http://")) {
        rewrittenLocation = "http://" + rewrittenLocation;
      }

      res.setHeader("X-Redirect-Rewritten", replacementCount > 0 ? "true" : "false");
      res.setHeader("X-Redirect-Replacements", replacementCount.toString());
      res.setHeader("Location", rewrittenLocation);
      return res.status(302).end();
    }

    res.setHeader("Location", targetUrl.toString());
    return res.status(302).end();
  } catch (error: any) {
    console.error("Express stream redirect fail:", error);
    res.setHeader("Location", targetUrl.toString());
    return res.status(302).end();
  }
};

app.all("/live/*", handleStreamRedirect);
app.all("/movie/*", handleStreamRedirect);
app.all("/series/*", handleStreamRedirect);

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
