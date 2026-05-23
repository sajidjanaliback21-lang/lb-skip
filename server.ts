import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "./src/lb-mapping.js";

dotenv.config();

const LBS = [
  "lb1.hdsj.store",
  "lb2.hdsj.store",
  "lb3.hdsj.store",
  "lb4.hdsj.store",
  "lb5.hdsj.store",
  "lb6.hdsj.store"
];

function getRandomLb() {
  return LBS[Math.floor(Math.random() * LBS.length)];
}

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

// Xtream Codes API Proxy and Playlist rewriter
const handleXtreamProxy = async (req: express.Request, res: express.Response) => {
  const file = req.path.substring(1) || "player_api.php";
  const targetUrl = new URL(`http://${DEFAULT_MAIN_SERVER_IP}:8080/${file}`);

  for (const [key, value] of Object.entries(req.query)) {
    targetUrl.searchParams.set(key, String(value));
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

    if (file === "get.php" || rewrittenText.trim().startsWith("#EXTM3U")) {
      // Dynamic load-balancing across the lines of an M3U file
      const lines = rewrittenText.split("\n");
      const parsedLines = lines.map(line => {
        if (line.includes(DEFAULT_MAIN_SERVER_IP)) {
          const randomLb = getRandomLb();
          // First force http
          let updatedLine = line.split("https://" + DEFAULT_MAIN_SERVER_IP).join("http://" + DEFAULT_MAIN_SERVER_IP);
          updatedLine = updatedLine.split(DEFAULT_MAIN_SERVER_IP).join(randomLb);
          
          // Ensure port :8080 is appended correctly
          if (updatedLine.includes(randomLb) && !updatedLine.includes(randomLb + ":8080")) {
            const portRegex = new RegExp(`${randomLb}:\\d+`, "g");
            if (updatedLine.match(portRegex)) {
              updatedLine = updatedLine.replace(portRegex, `${randomLb}:8080`);
            } else {
              updatedLine = updatedLine.replace(randomLb, `${randomLb}:8080`);
            }
          }
          replacementCount++;
          return updatedLine;
        }
        return line;
      });
      rewrittenText = parsedLines.join("\n");
    } else {
      // For general non-M3U/JSON responses, use a single randomized balancer
      const selectedLb = getRandomLb();

      // Clean up https and replace IP with the selected load balancer domain
      rewrittenText = rewrittenText.split("https://" + DEFAULT_MAIN_SERVER_IP).join("http://" + DEFAULT_MAIN_SERVER_IP);
      const countBefore = (rewrittenText.match(new RegExp(DEFAULT_MAIN_SERVER_IP, "g")) || []).length;
      rewrittenText = rewrittenText.split(DEFAULT_MAIN_SERVER_IP).join(selectedLb);
      replacementCount += countBefore;

      // Intercept and patch server_info block in JSON response
      if (rewrittenText.trim().startsWith("{") || rewrittenText.trim().startsWith("[")) {
        try {
          const obj = JSON.parse(rewrittenText);
          if (obj && obj.server_info) {
            obj.server_info.url = selectedLb;
            obj.server_info.port = "8080";
            obj.server_info.server_protocol = "http";
            if (obj.server_info.https_port) {
              obj.server_info.https_port = "8080";
            }
          }
          rewrittenText = JSON.stringify(obj);
        } catch (jsonErr) {
          console.error("JSON parsing error for server_info modification:", jsonErr);
        }
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

// Express stream wildcard redirect interceptor - returning 404 for media routes
const handleStreamRedirect = async (req: express.Request, res: express.Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(404).send("Not Found");
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
