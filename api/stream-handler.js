// Vercel Serverless Function to dynamically intercept /live/, /movie/ and /series/ stream requests,
// follow 302 redirects from the main server in the background, rewrite raw IPs to custom subdomains,
// and return a transparent 302 redirection straight to the client player.
import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "../src/lb-mapping.js";

export default async function handler(req, res) {
  // CORS Headers for standard players
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Get original request path structure from rewrites query parameters
  const streamType = req.query.streamType;
  const streamPath = req.query.path;
  
  let targetUrl;
  if (streamType && streamPath) {
    // Reconstruct utilizing the rewrite parameters
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== "streamType" && key !== "path" && key !== "customDomain") {
        queryParams.append(key, value);
      }
    }
    const queryString = queryParams.toString();
    const querySuffix = queryString ? `?${queryString}` : "";
    targetUrl = `http://${DEFAULT_MAIN_SERVER_IP}:8080/${streamType}/${streamPath}${querySuffix}`;
  } else {
    // Fallback if accessed directly or via another rewrite method
    const clientUrl = req.url || "";
    // If clientUrl starts with /api/stream-handler, try to extract from x-matched-path header or similar if present
    const matchedPath = req.headers["x-matched-path"] || req.headers["x-original-url"] || clientUrl;
    if (matchedPath && matchedPath.startsWith("/api/stream-handler")) {
      targetUrl = `http://${DEFAULT_MAIN_SERVER_IP}:8080${clientUrl}`;
    } else {
      targetUrl = `http://${DEFAULT_MAIN_SERVER_IP}:8080${matchedPath}`;
    }
  }

  // Custom Domain deduction
  const rawCustomDomain = req.query.customDomain || req.headers.host || "hdsj.store";
  let cleanDomain = rawCustomDomain;
  if (cleanDomain.includes(":")) {
    cleanDomain = cleanDomain.split(":")[0];
  }

  // Avoid Vercel app subdomains for LBs
  if (cleanDomain.includes("vercel.app") || cleanDomain.includes("localhost") || cleanDomain.includes("run.app")) {
    cleanDomain = "hdsj.store";
  }

  try {
    // Manual redirect handling ensures we catch the 302 without consuming the heavy media payload weight
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer",
        "Accept": req.headers["accept"] || "*/*",
      },
      redirect: "manual"
    });

    const locationHeader = response.headers.get("location");
    let finalLocation = targetUrl;

    if (locationHeader) {
      let rewrittenLocation = locationHeader;
      let replacementCount = 0;

      // Scan and replace raw LB IP with mapped custom subdomain
      for (const [ip, defaultSub] of Object.entries(INITIAL_MAPPINGS)) {
        const subStr = defaultSub;
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
      finalLocation = rewrittenLocation;
    }

    // return HTTP 302 Redirect for all streams including live TV
    res.setHeader("Location", finalLocation);
    return res.status(302).end();

  } catch (error) {
    console.error("Vercel Stream Interception Error:", error);
    res.setHeader("Location", targetUrl);
    return res.status(302).end();
  }
}
