// Vercel Serverless Function to intercept live/movie/series stream requests,
// follow 302 redirects in background, replace raw Load Balancer IPs with custom subdomains, 
// and perform the final 302 redirect back to the IPTV Player.
import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "../src/lb-mapping.js";

export default async function handler(req, res) {
  // CORS Headers for players
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const streamType = req.query.streamType; // "live", "movie", or "series"
  const streamPath = req.query.path;       // e.g. "username/password/123.ts"

  if (!streamType || !streamPath) {
    return res.status(400).send("Bad Request: Missing stream parameter or structure.");
  }

  // Determine Custom Domain to substitute with
  const rawCustomDomain = req.query.customDomain || req.headers.host || "yourdomain.com";
  let cleanDomain = rawCustomDomain;
  if (cleanDomain.includes(":")) {
    cleanDomain = cleanDomain.split(":")[0];
  }

  // Build target stream URL on the Main Server (port 8080)
  const targetUrl = new URL(`http://${DEFAULT_MAIN_SERVER_IP}:8080/${streamType}/${streamPath}`);

  // Re-append any other query parameters that the client passed
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== "streamType" && key !== "path" && key !== "customDomain") {
      targetUrl.searchParams.set(key, value);
    }
  }

  try {
    // Make a background request using standard fetch, instructing it to NOT pursue redirects automatically.
    // In node/browser context, redirect: "manual" returns the raw 3xx redirect response.
    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVPlayer",
        "Accept": req.headers["accept"] || "*/*",
      },
      redirect: "manual"
    });

    // Check for Location header from the response
    const locationHeader = response.headers.get("location");

    if (locationHeader) {
      let rewrittenLocation = locationHeader;
      let replacementCount = 0;

      // Swap the raw LB IP inside the Location header with the configured subdomain
      for (const [ip, defaultSub] of Object.entries(INITIAL_MAPPINGS)) {
        const subStr = defaultSub;
        const prefix = subStr.split(".")[0];
        const replacement = `${prefix}.${cleanDomain}`;

        if (rewrittenLocation.includes(ip)) {
          rewrittenLocation = rewrittenLocation.split(ip).join(replacement);
          replacementCount++;
        }
      }

      // Output performance headers
      res.setHeader("X-Redirect-Rewritten", replacementCount > 0 ? "true" : "false");
      res.setHeader("X-Redirect-Replacements", replacementCount.toString());
      res.setHeader("Location", rewrittenLocation);
      
      // Perform 302 Redirect to the player with the custom subdomain URL
      return res.status(302).end();
    }

    // Fallback: If no redirect was triggered by the Main Server, forward the original headers and response stream.
    // However, since we shouldn't act as a heavy media proxy, we can also construct a redirect directly to the LB.
    // Let's craft a backup redirect to default server IP stream URL if no redirect found.
    res.setHeader("Location", targetUrl.toString());
    return res.status(302).end();

  } catch (error) {
    console.error("Stream redirect interception failed:", error);
    // Return mock play m3u or 302 fallback to prevent player freeze
    res.setHeader("Location", targetUrl.toString());
    return res.status(302).end();
  }
}
