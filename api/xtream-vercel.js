// Vercel Serverless Function to act as a transparent Xtream Codes proxy
import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "../src/lb-mapping.js";

export default async function handler(req, res) {
  // Set CORS headers so standard IPTV players don't face browser-level restrictions
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, User-Agent, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Retrieve the requested Xtream Codes endpoint file name ('player_api.php', 'get.php', or 'xmltv.php')
  const file = req.query.file || "player_api.php";

  // Reconstruct target URL pointing to the IPTV Main Server
  const targetBase = `http://${DEFAULT_MAIN_SERVER_IP}`;
  const targetUrl = new URL(`${targetBase}/${file}`);

  // Copy all incoming query parameters (except the helper 'file' parameter)
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== "file") {
      targetUrl.searchParams.set(key, value);
    }
  }

  // Determine customDomain using query, headers, or default
  const rawCustomDomain = req.query.customDomain || req.headers.host || "yourdomain.com";
  let cleanDomain = rawCustomDomain;
  if (cleanDomain.includes(":")) {
    cleanDomain = cleanDomain.split(":")[0];
  }

  try {
    // Prep headers to send upstream (strip Content-Encoding to avoid compressed body parsing complexities)
    const forwardHeaders = {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer",
      "Accept": req.headers["accept"] || "*/*",
    };

    // Forward Authorization if present
    if (req.headers["authorization"]) {
      forwardHeaders["Authorization"] = req.headers["authorization"];
    }

    // Build fetch parameters
    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
    };

    // Forward body if POST request is supplied
    if (req.method === "POST" && req.body) {
      if (typeof req.body === "string") {
        fetchOptions.body = req.body;
        if (req.headers["content-type"]) {
          forwardHeaders["Content-Type"] = req.headers["content-type"];
        }
      } else {
        // Automatically serialize object requests (standard form data)
        const formParams = new URLSearchParams();
        for (const [k, v] of Object.entries(req.body)) {
          formParams.append(k, String(v));
        }
        fetchOptions.body = formParams.toString();
        forwardHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      }
    }

    // Fetch original payload from the Main Server
    const response = await fetch(targetUrl.toString(), fetchOptions);

    // Get response content-type
    const contentType = response.headers.get("content-type") || "text/plain";
    
    // Read response text
    const responseText = await response.text();
    let rewrittenText = responseText;
    let replacementCount = 0;

    // Direct String scan and replace for each mapping rule configured
    for (const [ip, defaultSub] of Object.entries(INITIAL_MAPPINGS)) {
      const subStr = defaultSub;
      const prefix = subStr.split(".")[0];
      const replacement = `${prefix}.${cleanDomain}`;

      // Escape IP for count check regex
      const escapedIp = ip.replace(/\./g, "\\.");
      const regex = new RegExp(escapedIp, "g");
      const matches = (responseText.match(regex) || []).length;

      if (matches > 0) {
        replacementCount += matches;
        // Global replacement
        rewrittenText = rewrittenText.split(ip).join(replacement);
      }
    }

    // Return the modified content with corresponding headers back to user's IPTV client
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Replacement-Count", replacementCount.toString());
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    return res.status(response.status).send(rewrittenText);

  } catch (error) {
    console.error("Xtream Codes proxy rewrite failed:", error);
    res.setHeader("Content-Type", "application/json");
    return res.status(502).json({
      error: "Xtream proxy mapping failure",
      message: error.message || "Could not complete proxy communication with upstream server."
    });
  }
}
