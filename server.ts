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

function rewriteStreamExtensionsInText(text: string): string {
  if (!text) return text;
  // Strict separation: ONLY rewrite /movie/ and /series/ paths to .m3u8. Preserve/force .ts for /live/ paths.
  const regex = /(\\?\/)(live|movie|series)(\\?\/)([^\/\\\?\s"']+)(\\?\/)([^\/\\\?\s"']+)(\\?\/)([^\/\\\?\s"'\.]+)(\.[a-zA-Z0-9]+)?/g;
  return text.replace(regex, (match, s1, type, s2, username, s3, password, s4, streamId, ext) => {
    if (type === "movie" || type === "series") {
      return `${s1}${type}${s2}${username}${s3}${password}${s4}${streamId}.m3u8`;
    } else {
      const currentExt = ext ? ext.toLowerCase() : "";
      if (currentExt === ".m3u8") {
        return `${s1}${type}${s2}${username}${s3}${password}${s4}${streamId}.ts`;
      }
      return `${s1}${type}${s2}${username}${s3}${password}${s4}${streamId}${ext || ".ts"}`;
    }
  });
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
      "X-Forwarded-For": (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.connection?.remoteAddress || "") as string,
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

    // Rewrite stream extensions in the final response text safely
    rewritten = rewriteStreamExtensionsInText(rewritten);

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
      "X-Forwarded-For": (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.connection?.remoteAddress || "") as string,
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

    const targetIps = ["149.18.66.28", "45.142.0.21"];
    const proxyHost = req.headers.host || "hdsj.store";
    const proxyProto = req.headers["x-forwarded-proto"] || "http";
    
    // Split proxy host to determine correct host and port
    let hostOnly = proxyHost;
    let portOnly = proxyProto === "https" ? "443" : "80";
    if (proxyHost.includes(":")) {
      const parts = proxyHost.split(":");
      hostOnly = parts[0];
      portOnly = parts[1];
    }

    if (file === "get.php" || rewrittenText.trim().startsWith("#EXTM3U")) {
      // Dynamic load-balancing across the lines of an M3U file
      const lines = rewrittenText.split("\n");
      const parsedLines = lines.map(line => {
        let updatedLine = line;
        for (const targetIp of targetIps) {
          if (updatedLine.includes(targetIp)) {
            const randomLb = getRandomLb();
            // Replace <targetIp>:8080 with just <randomLb> (stripping the port)
            updatedLine = updatedLine.split(`${targetIp}:8080`).join(randomLb);
            // Replace any other raw <targetIp> with <randomLb>
            updatedLine = updatedLine.split(targetIp).join(randomLb);
            
            // Strictly make sure no :8080 port remains attached to the load balancer domain
            const portRegex = new RegExp(`${randomLb.replace(/\./g, "\\.")}:\\d+`, "g");
            if (updatedLine.match(portRegex)) {
              updatedLine = updatedLine.replace(portRegex, randomLb);
            }
            replacementCount++;
          }
        }
        return updatedLine;
      });
      rewrittenText = parsedLines.join("\n");
    } else {
      // For general non-M3U/JSON responses (e.g. player_api.php), target both IPs and replace them with the proxy host (req.headers.host)
      for (const targetIp of targetIps) {
        // Clean up any https protocol for this IP
        rewrittenText = rewrittenText.split("https://" + targetIp).join("http://" + targetIp);

        // First look for IP:8080 and replace it with proxyHost cleanly to avoid trailing port 8080 mismatch
        const ipWithPort = `${targetIp}:8080`;
        const countWithPort = (rewrittenText.match(new RegExp(ipWithPort.replace(/\./g, "\\."), "g")) || []).length;
        rewrittenText = rewrittenText.split(ipWithPort).join(proxyHost);
        replacementCount += countWithPort;

        // Then look for raw IP and replace it with proxyHost
        const countRaw = (rewrittenText.match(new RegExp(targetIp.replace(/\./g, "\\."), "g")) || []).length;
        rewrittenText = rewrittenText.split(targetIp).join(proxyHost);
        replacementCount += countRaw;
      }

      // Intercept and patch server_info block in JSON response
      if (rewrittenText.trim().startsWith("{") || rewrittenText.trim().startsWith("[")) {
        try {
          const obj = JSON.parse(rewrittenText);
          if (obj && obj.server_info) {
            obj.server_info.url = hostOnly;
            obj.server_info.port = portOnly;
            obj.server_info.server_protocol = proxyProto;
            if (obj.server_info.https_port) {
              obj.server_info.https_port = proxyProto === "https" ? portOnly : "443";
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

    // Rewrite stream extensions in the final response text safely
    rewrittenText = rewriteStreamExtensionsInText(rewrittenText);

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

// Express stream wildcard redirect interceptor
const REDIRECT_MAP = {
  "103.169.98.238": "lb1.hdsj.store",
  "45.148.147.213": "lb2.hdsj.store",
  "45.88.0.176": "lb3.hdsj.store",
  "181.215.178.154": "lb4.hdsj.store",
  "45.159.92.158": "lb5.hdsj.store",
  "181.215.178.23": "lb6.hdsj.store",
  "149.18.66.28": "lb1.hdsj.store"
};

function rewriteLocationHeader(locationUrl: string, streamType: string = "live"): string {
  if (!locationUrl) return locationUrl;
  let type = streamType;
  if (locationUrl.includes("/movie/")) {
    type = "movie";
  } else if (locationUrl.includes("/series/")) {
    type = "series";
  } else if (locationUrl.includes("/live/")) {
    type = "live";
  } else if (!type) {
    type = "live";
  }

  try {
    const urlObj = new URL(locationUrl);
    const host = urlObj.hostname;
    
    let matched = false;
    if (REDIRECT_MAP[host as keyof typeof REDIRECT_MAP]) {
      urlObj.hostname = REDIRECT_MAP[host as keyof typeof REDIRECT_MAP];
      urlObj.port = "";
      urlObj.protocol = "https:";
      matched = true;
    } else {
      for (const [ip, domain] of Object.entries(REDIRECT_MAP)) {
        if (host === ip) {
          urlObj.hostname = domain;
          urlObj.port = "";
          urlObj.protocol = "https:";
          matched = true;
          break;
        }
      }
      if (!matched && (host === "149.18.66.28" || host === "45.142.0.21" || host.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/))) {
        const mappedDomain = REDIRECT_MAP[host as keyof typeof REDIRECT_MAP] || REDIRECT_MAP["149.18.66.28"];
        urlObj.hostname = mappedDomain;
        urlObj.port = "";
        urlObj.protocol = "https:";
        matched = true;
      }
    }

    // Rewrite path file extension depending on stream type
    let pathname = urlObj.pathname;
    const isVod = (type === "movie" || type === "series");
    
    if (isVod) {
      // Forcefully rewrite the file extension inside urlObj.pathname to .m3u8
      if (!pathname.toLowerCase().endsWith(".m3u8")) {
        const extRegex = /\.[a-zA-Z0-9]+$/i;
        if (extRegex.test(pathname)) {
          pathname = pathname.replace(extRegex, ".m3u8");
        } else {
          pathname = pathname + ".m3u8";
        }
      }
    } else {
      // Live TV: Do NOT force .m3u8. If no media extension is present, append .ts
      const pathPartClean = pathname.split("?")[0].toLowerCase();
      const hasMediaExtension = pathPartClean.endsWith(".ts") || 
                                pathPartClean.endsWith(".mp4") || 
                                pathPartClean.endsWith(".mkv") || 
                                pathPartClean.endsWith(".m3u8");
      if (!hasMediaExtension) {
        pathname = pathname + ".ts";
      }
    }
    urlObj.pathname = pathname;

    return urlObj.toString();
  } catch (err) {
    let modified = locationUrl;
    for (const [ip, domain] of Object.entries(REDIRECT_MAP)) {
      modified = modified.replace(new RegExp(`${ip}:8080`, "g"), domain);
      modified = modified.replace(new RegExp(`${ip}:\\d+`, "g"), domain);
      modified = modified.replace(new RegExp(ip, "g"), domain);
    }
    for (const domain of Object.values(REDIRECT_MAP)) {
      if (modified.includes(domain)) {
        modified = modified.replace("http://", "https://");
      }
    }

    // Fallback string manipulation to ensure correct extension in error catch block
    try {
      const isVod = (type === "movie" || type === "series");
      const queryParts = modified.split("?");
      let beforeQuery = queryParts[0];
      
      if (isVod) {
        if (!beforeQuery.toLowerCase().endsWith(".m3u8")) {
          const extRegex = /\.[a-zA-Z0-9]+$/i;
          if (extRegex.test(beforeQuery)) {
            beforeQuery = beforeQuery.replace(extRegex, ".m3u8");
          } else {
            beforeQuery = beforeQuery + ".m3u8";
          }
        }
      } else {
        const pathPartClean = beforeQuery.toLowerCase();
        const hasMediaExtension = pathPartClean.endsWith(".ts") || 
                                  pathPartClean.endsWith(".mp4") || 
                                  pathPartClean.endsWith(".mkv") || 
                                  pathPartClean.endsWith(".m3u8");
        if (!hasMediaExtension) {
          beforeQuery = beforeQuery + ".ts";
        }
      }
      queryParts[0] = beforeQuery;
      modified = queryParts.join("?");
    } catch (e) {}

    return modified;
  }
}

function rewriteM3u8Content(text: string): string {
  if (!text) return text;
  let rewritten = text;
  
  // Replace target IPs with their subdomain counterparts, and handle ports & protocol
  for (const [ip, domain] of Object.entries(REDIRECT_MAP)) {
    const escapedIp = ip.replace(/\./g, "\\.");
    
    // Replace http://ip:8080 or http://ip with https://domain
    rewritten = rewritten.replace(new RegExp(`http://${escapedIp}(:\\d+)?`, "g"), `https://${domain}`);
    rewritten = rewritten.replace(new RegExp(`https://${escapedIp}(:\\d+)?`, "g"), `https://${domain}`);
    
    // Default fallback replacement for any residual IP occurrences
    rewritten = rewritten.replace(new RegExp(escapedIp, "g"), domain);
  }
  
  // Strip any residual port 8080 or other port from the load balancer domains if they were somehow left over
  for (const domain of Object.values(REDIRECT_MAP)) {
    const escapedDomain = domain.replace(/\./g, "\\.");
    const residualPortRegex = new RegExp(`${escapedDomain}:\\d+`, "g");
    rewritten = rewritten.replace(residualPortRegex, domain);
  }
  
  // Force secure https protocol for all of our custom domains
  for (const domain of Object.values(REDIRECT_MAP)) {
    const httpRegex = new RegExp(`http://${domain.replace(/\./g, "\\.")}`, "g");
    rewritten = rewritten.replace(httpRegex, `https://${domain}`);
  }

  return rewritten;
}

const handleStreamRedirect = async (req: express.Request, res: express.Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const pathParts = req.path.split("/");
  // pathParts will look like ["", "live", "user", "pass", "123.ts"] or similar
  const streamType = pathParts[1]; // "live" | "movie" | "series"
  let streamPath = pathParts.slice(2).join("/");

  if (!streamType || !streamPath) {
    return res.status(400).send("Bad request parameters.");
  }

  // Extension Fallback Check: check if the request path has a media extension
  const pathPartClean = streamPath.split("?")[0].toLowerCase();
  const hasMediaExtension = pathPartClean.endsWith(".ts") || 
                            pathPartClean.endsWith(".mp4") || 
                            pathPartClean.endsWith(".mkv") || 
                            pathPartClean.endsWith(".m3u8");
  if (!hasMediaExtension && streamType === "live") {
    streamPath = streamPath + ".ts";
  }

  const targetUrl = new URL(`http://${DEFAULT_MAIN_SERVER_IP}:8080/${streamType}/${streamPath}`);
  for (const [key, value] of Object.entries(req.query)) {
    targetUrl.searchParams.set(key, String(value));
  }

  const isM3u8 = streamPath.split("?")[0].toLowerCase().endsWith(".m3u8") && streamType !== "live";

  if (isM3u8) {
    try {
      const forwardHeaders = {
        "User-Agent": (req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer") as string,
        "Accept": (req.headers["accept"] || "*/*") as string,
        "X-Forwarded-For": (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.connection?.remoteAddress || "") as string
      };

      const response = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: forwardHeaders,
        redirect: "follow" // Follow redirects to get real m3u8 playlist file
      });

      if (!response.ok) {
        // Redirection fallback if request failed
        const finalFallback = rewriteLocationHeader(targetUrl.toString(), streamType);
        res.setHeader("Location", finalFallback);
        return res.status(302).end();
      }

      const text = await response.text();
      const rewrittenText = rewriteM3u8Content(text);

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Content-Length", Buffer.byteLength(rewrittenText).toString());
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.status(200).send(rewrittenText);
    } catch (err) {
      console.error("Error in server m3u8 playlist rewrite:", err);
      // fallback to 302 redirect on exception
      const finalFallback = rewriteLocationHeader(targetUrl.toString(), streamType);
      res.setHeader("Location", finalFallback);
      return res.status(302).end();
    }
  }

  try {
    const forwardHeaders: Record<string, string> = {
      "User-Agent": (req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer") as string,
      "Accept": (req.headers["accept"] || "*/*") as string,
      "X-Forwarded-For": (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.connection?.remoteAddress || "") as string
    };

    if (req.headers["range"]) {
      forwardHeaders["Range"] = req.headers["range"] as string;
    }

    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: forwardHeaders,
      redirect: "manual" // Prevent auto-following of redirects for raw TS/MP4 to check redirect links
    });

    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const originalLocation = response.headers.get("location");
      if (originalLocation) {
        const rewrittenLocation = rewriteLocationHeader(originalLocation, streamType);
        res.setHeader("Location", rewrittenLocation);
        return res.status(302).end();
      }
    }

    // Forward byte-range / headers properly to handle partial media content
    const copyHeaders = ["content-type", "content-length", "content-range", "accept-ranges"];
    for (const h of copyHeaders) {
      const val = response.headers.get(h);
      if (val) {
        res.setHeader(h, val);
      }
    }

    res.status(response.status);

    if (response.body) {
      if (typeof (response.body as any).getReader === "function") {
        const reader = (response.body as any).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      } else if (typeof (response.body as any).pipe === "function") {
        (response.body as any).pipe(res);
        return;
      } else {
        const buffer = await response.arrayBuffer();
        res.write(Buffer.from(buffer));
      }
    }
    return res.end();
  } catch (err) {
    console.error("Error in stream-handler redirect intercept:", err);
    // fallback on error
    const finalFallback = rewriteLocationHeader(targetUrl.toString(), streamType);
    res.setHeader("Location", finalFallback);
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
