// Vercel Serverless Function to act as a transparent Xtream Codes proxy and API Playlist Rewriter
import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "../src/lb-mapping.js";

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
  // Set CORS headers so standard IPTV players don't face browser-level restrictions
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, User-Agent, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Retrieve the requested Xtream Codes endpoint file name ('player_api.php', 'get.php', or 'xmltv.php')
  const file = req.query.file || "player_api.php";

  // Reconstruct target URL pointing to the IPTV Main Server on Port 8080
  const targetBase = `http://${DEFAULT_MAIN_SERVER_IP}:8080`;
  const targetUrl = new URL(`${targetBase}/${file}`);

  // Copy all incoming query parameters (except the helper 'file' and 'customDomain' parameters)
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== "file" && key !== "customDomain") {
      targetUrl.searchParams.set(key, value);
    }
  }

  try {
    // Prep headers to send upstream (Ensure you pass exact User-Agent from the client)
    const forwardHeaders = {
      "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVStreamPlayer",
      "Accept": req.headers["accept"] || "*/*",
      "X-Forwarded-For": req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.connection?.remoteAddress || ""
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

    // Return the modified content with corresponding headers back to user's IPTV client
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Replacement-Count", replacementCount.toString());
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    // Rewrite stream extensions in the final response text safely
    rewrittenText = rewriteStreamExtensionsInText(rewrittenText);

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
