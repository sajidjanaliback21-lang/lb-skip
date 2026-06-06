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

function rewriteLocationHeader(locationUrl, streamType = "live") {
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

  // Extension Fallback Check: append .ts for live stream if no extension is present
  const pathPartClean = streamPath.split("?")[0].toLowerCase();
  const hasMediaExtension = pathPartClean.endsWith(".ts") || 
                            pathPartClean.endsWith(".mp4") || 
                            pathPartClean.endsWith(".mkv") || 
                            pathPartClean.endsWith(".m3u8");
  if (!hasMediaExtension && streamType === "live") {
    streamPath = streamPath + ".ts";
  }

  const targetIp = DEFAULT_MAIN_SERVER_IP || "149.18.66.28";
  const targetUrl = new URL(`http://${targetIp}:8080/${streamType}/${streamPath}`);
  
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

  const isM3u8 = streamPath.split("?")[0].toLowerCase().endsWith(".m3u8") && streamType !== "live";

  if (isM3u8) {
    try {
      const forwardHeaders = {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer",
        "Accept": req.headers["accept"] || "*/*",
        "X-Forwarded-For": req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.connection?.remoteAddress || ""
      };

      const response = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: forwardHeaders,
        redirect: "follow" // Follow redirects to get real m3u8 playlist file
      });

      if (!response.ok) {
        // redirection fallback if request failed
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
      console.error("Error in m3u8 playlist rewrite:", err);
      // fallback to 302 redirect on exception
      const finalFallback = rewriteLocationHeader(targetUrl.toString(), streamType);
      res.setHeader("Location", finalFallback);
      return res.status(302).end();
    }
  }

  // For media streaming (including chunk proxy and seeking range support)
  try {
    const forwardHeaders = {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer",
      "Accept": req.headers["accept"] || "*/*",
      "X-Forwarded-For": req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.connection?.remoteAddress || ""
    };

    if (req.headers["range"]) {
      forwardHeaders["Range"] = req.headers["range"];
    }

    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: forwardHeaders,
      redirect: "manual" // Prevent auto-following of redirects for raw TS/MP4 files to check redirect links
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
    // fallback on error
    const finalFallback = rewriteLocationHeader(targetUrl.toString(), streamType);
    res.setHeader("Location", finalFallback);
    return res.status(302).end();
  }
}

