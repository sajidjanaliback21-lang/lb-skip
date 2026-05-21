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

  // Get original request path and query parameters (e.g., /movie/user/pass/123.mp4?any=param)
  const clientUrl = req.url || "";
  
  // Construct destination stream URL pointing to the IPTV Main Server on port 8080
  const targetUrl = `http://${DEFAULT_MAIN_SERVER_IP}:8080${clientUrl}`;

  // Custom Domain deduction
  const rawCustomDomain = req.query.customDomain || req.headers.host || "yourdomain.com";
  let cleanDomain = rawCustomDomain;
  if (cleanDomain.includes(":")) {
    cleanDomain = cleanDomain.split(":")[0];
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

      res.setHeader("X-Redirect-Rewritten", replacementCount > 0 ? "true" : "false");
      res.setHeader("X-Redirect-Replacements", replacementCount.toString());
      res.setHeader("Location", rewrittenLocation);
      
      return res.status(302).end();
    }

    // Direct fallback redirect
    res.setHeader("Location", targetUrl);
    return res.status(302).end();

  } catch (error) {
    console.error("Vercel Stream Interception Error:", error);
    res.setHeader("Location", targetUrl);
    return res.status(302).end();
  }
}
