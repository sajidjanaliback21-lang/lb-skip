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

function rewriteLocationHeader(locationUrl) {
  if (!locationUrl) return locationUrl;
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
    return modified;
  }
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent");

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

  try {
    const forwardHeaders = {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer",
      "Accept": req.headers["accept"] || "*/*"
    };

    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: forwardHeaders,
      redirect: "manual" // Prevent auto-following of redirects
    });

    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const originalLocation = response.headers.get("location");
      if (originalLocation) {
        const rewrittenLocation = rewriteLocationHeader(originalLocation);
        res.setHeader("Location", rewrittenLocation);
        return res.status(302).end();
      }
    }

    // fallback if no redirect header was found or it was a non-redirect status
    const finalFallback = rewriteLocationHeader(targetUrl.toString());
    res.setHeader("Location", finalFallback);
    return res.status(302).end();
  } catch (err) {
    console.error("Error in stream-handler redirect intercept:", err);
    // fallback on error
    const finalFallback = rewriteLocationHeader(targetUrl.toString());
    res.setHeader("Location", finalFallback);
    return res.status(302).end();
  }
}

