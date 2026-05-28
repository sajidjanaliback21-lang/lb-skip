// Vercel Serverless Function - Media stream redirect handler
// Redirects requests to the main server to bypass Vercel serverless limitations and enable proper playback

import { DEFAULT_MAIN_SERVER_IP } from "../src/lb-mapping.js";

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

  res.setHeader("Location", targetUrl.toString());
  return res.status(302).end();
}

