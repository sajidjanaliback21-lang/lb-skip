// Vercel Serverless Function - Media stream redirect handler
// Redirects requests to the main server to bypass Vercel serverless limitations and enable proper playback

import { DEFAULT_MAIN_SERVER_IP } from "../src/lb-mapping.js";

const REDIRECT_MAP = {
  "103.169.98.238": "lb1.hdsj.store",
  "45.148.147.213": "lb2.hdsj.store",
  "45.88.0.176": "lb3.hdsj.store",
  "181.215.178.154": "lb4.hdsj.store",
  "45.159.92.158": "lb5.hdsj.store",
  "181.215.178.23": "lb6.hdsj.store",
  "149.18.66.28": "lb1.hdsj.store"
};

function rewriteLocationHeader(locationUrl, streamType = "live", isDownload = false) {
  if (!locationUrl) return locationUrl;
  let type = streamType;
  if (!type) {
    if (locationUrl.includes("/movie/")) {
      type = "movie";
    } else if (locationUrl.includes("/series/")) {
      type = "series";
    } else if (locationUrl.includes("/live/")) {
      type = "live";
    }
  }

  try {
    const urlObj = new URL(locationUrl);
    const host = urlObj.hostname;
    
    let matched = false;
    if (REDIRECT_MAP[host]) {
      urlObj.hostname = REDIRECT_MAP[host];
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
        const mappedDomain = REDIRECT_MAP[host] || REDIRECT_MAP["149.18.66.28"];
        urlObj.hostname = mappedDomain;
        urlObj.port = "";
        urlObj.protocol = "https:";
        matched = true;
      }
    }

    let pathname = urlObj.pathname;
    
    if (type === "live") {
      // 1. For LIVE TV: MUST retain the original .ts extension and DO NOT append download=true.
      const pathPartClean = pathname.split("?")[0].toLowerCase();
      const hasMediaExtension = pathPartClean.endsWith(".ts") || 
                                pathPartClean.endsWith(".mp4") || 
                                pathPartClean.endsWith(".mkv") || 
                                pathPartClean.endsWith(".m3u8");
      if (!hasMediaExtension) {
        pathname = pathname + ".ts";
      }
      urlObj.searchParams.delete("download");
    } else if (isDownload) {
      // 3. For VOD DOWNLOADS: Replace .mkv with .mp4 in the final Location redirect and MUST append download=true.
      if (!pathname.toLowerCase().endsWith(".mp4")) {
        const extRegex = /\.[a-zA-Z0-9]+$/i;
        if (extRegex.test(pathname)) {
          pathname = pathname.replace(extRegex, ".mp4");
        } else {
          pathname = pathname + ".mp4";
        }
      }
      urlObj.searchParams.set("download", "true");
    } else {
      // 2. For VOD STREAMING: Force Auto-HLS (ALWAYS replace extension in final Location redirect to .m3u8). DO NOT append download=true.
      if (!pathname.toLowerCase().endsWith(".m3u8")) {
        const extRegex = /\.[a-zA-Z0-9]+$/i;
        if (extRegex.test(pathname)) {
          pathname = pathname.replace(extRegex, ".m3u8");
        } else {
          pathname = pathname + ".m3u8";
        }
      }
      urlObj.searchParams.delete("download");
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

    try {
      const queryParts = modified.split("?");
      let beforeQuery = queryParts[0];
      const queryPartsCleanArray = queryParts.slice(1);
      const queryParams = new URLSearchParams(queryPartsCleanArray.join("&"));

      if (type === "live") {
        const pathPartClean = beforeQuery.toLowerCase();
        const hasMediaExtension = pathPartClean.endsWith(".ts") || 
                                  pathPartClean.endsWith(".mp4") || 
                                  pathPartClean.endsWith(".mkv") || 
                                  pathPartClean.endsWith(".m3u8");
        if (!hasMediaExtension) {
          beforeQuery = beforeQuery + ".ts";
        }
        queryParams.delete("download");
      } else if (isDownload) {
        if (!beforeQuery.toLowerCase().endsWith(".mp4")) {
          const extRegex = /\.[a-zA-Z0-9]+$/i;
          if (extRegex.test(beforeQuery)) {
            beforeQuery = beforeQuery.replace(extRegex, ".mp4");
          } else {
            beforeQuery = beforeQuery + ".mp4";
          }
        }
        queryParams.set("download", "true");
      } else {
        if (!beforeQuery.toLowerCase().endsWith(".m3u8")) {
          const extRegex = /\.[a-zA-Z0-9]+$/i;
          if (extRegex.test(beforeQuery)) {
            beforeQuery = beforeQuery.replace(extRegex, ".m3u8");
          } else {
            beforeQuery = beforeQuery + ".m3u8";
          }
        }
        queryParams.delete("download");
      }

      const newQueryString = queryParams.toString();
      modified = beforeQuery + (newQueryString ? "?" + newQueryString : "");
    } catch (e) {}

    return modified;
  }
}

function rewriteM3u8Content(text) {
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

function rewriteStreamExtensionsInText(text) {
  if (!text) return text;
  // This matches both "/live/user/pass/123" and "\/live\/user\/pass\/123" (with or without extension)
  const regex = /(\\?\/)((?:live|movie|series))(\\?\/)([^\/\\\?\s"']+)(\\?\/)([^\/\\\?\s"']+)(\\?\/)([^\/\\\?\s"'\.]+)(\.[a-zA-Z0-9]+)?/g;
  return text.replace(regex, (match, s1, type, s2, username, s3, password, s4, streamId, ext) => {
    if (type === "movie" || type === "series") {
      return `${s1}${type}${s2}${username}${s3}${password}${s4}${streamId}.m3u8`;
    } else {
      return `${s1}${type}${s2}${username}${s3}${password}${s4}${streamId}${ext || ".ts"}`;
    }
  });
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent, Range");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const streamType = req.query.streamType || "live";
  let streamPath = req.query.path;

  if (!streamPath) {
    return res.status(400).send("Bad request parameters. Path is missing.");
  }

  // Handle both array of segments and single string path
  if (Array.isArray(streamPath)) {
    streamPath = streamPath.join("/");
  }

  const pathPartClean = streamPath.split("?")[0].toLowerCase();
  
  const isLive = streamType === "live";
  const isVodDownload = (streamType === "movie" || streamType === "series") && pathPartClean.endsWith(".mkv");
  const isVodStreaming = (streamType === "movie" || streamType === "series") && !pathPartClean.endsWith(".mkv");

  // Determine headers to proxy.
  // ALWAYS pass client's real IP (X-Forwarded-For) to Main Server.
  const clientIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.connection?.remoteAddress || "";
  const forwardHeaders = {
    "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer",
    "Accept": req.headers["accept"] || "*/*",
    "X-Forwarded-For": clientIp
  };

  let forwardStreamPath = streamPath;

  if (isLive) {
    // 1. For LIVE TV: Retain the original .ts extension or append if missing
    const hasMediaExtension = pathPartClean.endsWith(".ts") || 
                              pathPartClean.endsWith(".mp4") || 
                              pathPartClean.endsWith(".mkv") || 
                              pathPartClean.endsWith(".m3u8");
    if (!hasMediaExtension) {
      forwardStreamPath = streamPath + ".ts";
    }
  } else if (isVodDownload) {
    // 3. For VOD DOWNLOADS: Backend Translation - change `.mkv` back to `.mp4`
    forwardStreamPath = streamPath.replace(/\.mkv$/i, ".mp4");
  }

  const targetIp = DEFAULT_MAIN_SERVER_IP || "149.18.66.28";
  const targetUrl = new URL(`http://${targetIp}:8080/${streamType}/${forwardStreamPath}`);
  
  // Forward query string parameters (excluding our internal rewrite keys)
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== "streamType" && key !== "path" && key !== "customDomain") {
      if (Array.isArray(value)) {
        targetUrl.searchParams.set(key, String(value[0]));
      } else {
        targetUrl.searchParams.set(key, String(value));
      }
    }
  }

  // Check if we are doing a standard .m3u8 playlist fetch-and-rewrite (VOD Streaming Only)
  const isM3u8 = forwardStreamPath.split("?")[0].toLowerCase().endsWith(".m3u8");

  if (isM3u8 && isVodStreaming) {
    try {
      const response = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: forwardHeaders,
        redirect: "follow" // Follow redirects to get real m3u8 playlist file
      });

      if (!response.ok) {
        const finalFallback = rewriteLocationHeader(targetUrl.toString(), streamType, false);
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
      console.error("Error in m3u8 playlist rewrite:", err);
      const finalFallback = rewriteLocationHeader(targetUrl.toString(), streamType, false);
      res.setHeader("Location", finalFallback);
      return res.status(302).end();
    }
  }

  // Handle stream proxying/redirects for LIVE TV, VOD Downloads, VOD Streaming
  try {
    if (req.headers["range"]) {
      forwardHeaders["Range"] = req.headers["range"];
    }

    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: forwardHeaders,
      redirect: "manual" // Intercept redirect headers
    });

    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const originalLocation = response.headers.get("location");
      if (originalLocation) {
        const rewrittenLocation = rewriteLocationHeader(originalLocation, streamType, isVodDownload);
        res.setHeader("Location", rewrittenLocation);
        return res.status(302).end();
      }
    }

    // Special fallback for VOD Downloads: if origin responded with non-redirect (e.g., 200), we redirect to rewritten target URL
    if (isVodDownload) {
      const rewrittenTargetUrl = rewriteLocationHeader(targetUrl.toString(), streamType, true);
      res.setHeader("Location", rewrittenTargetUrl);
      return res.status(302).end();
    }

    // Forward byte-range/headers for media streaming playback
    const copyHeaders = ["content-type", "content-length", "content-range", "accept-ranges"];
    for (const h of copyHeaders) {
      const val = response.headers.get(h);
      if (val) {
        res.setHeader(h, val);
      }
    }

    res.status(response.status);

    if (response.body) {
      if (typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      } else if (typeof response.body.pipe === "function") {
        response.body.pipe(res);
        return;
      } else {
        const buffer = await response.arrayBuffer();
        res.write(Buffer.from(buffer));
      }
    }
    return res.end();
  } catch (err) {
    console.error("Error in stream-handler redirect intercept:", err);
    const finalFallback = rewriteLocationHeader(targetUrl.toString(), streamType, isVodDownload);
    res.setHeader("Location", finalFallback);
    return res.status(302).end();
  }
}

