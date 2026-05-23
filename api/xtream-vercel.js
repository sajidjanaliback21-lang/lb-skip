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

    if (file === "get.php" || rewrittenText.trim().startsWith("#EXTM3U")) {
      // Dynamic load-balancing across the lines of an M3U file
      const lines = rewrittenText.split("\n");
      const parsedLines = lines.map(line => {
        if (line.includes(DEFAULT_MAIN_SERVER_IP)) {
          const randomLb = getRandomLb();
          // First force http
          let updatedLine = line.split("https://" + DEFAULT_MAIN_SERVER_IP).join("http://" + DEFAULT_MAIN_SERVER_IP);
          updatedLine = updatedLine.split(DEFAULT_MAIN_SERVER_IP).join(randomLb);
          
          // Ensure port :8080 is appended correctly
          if (updatedLine.includes(randomLb) && !updatedLine.includes(randomLb + ":8080")) {
            const portRegex = new RegExp(`${randomLb}:\\d+`, "g");
            if (updatedLine.match(portRegex)) {
              updatedLine = updatedLine.replace(portRegex, `${randomLb}:8080`);
            } else {
              updatedLine = updatedLine.replace(randomLb, `${randomLb}:8080`);
            }
          }
          replacementCount++;
          return updatedLine;
        }
        return line;
      });
      rewrittenText = parsedLines.join("\n");
    } else {
      // For general non-M3U/JSON responses, use a single randomized balancer
      const selectedLb = getRandomLb();

      // Clean up https and replace IP with the selected load balancer domain
      rewrittenText = rewrittenText.split("https://" + DEFAULT_MAIN_SERVER_IP).join("http://" + DEFAULT_MAIN_SERVER_IP);
      
      const countBefore = (rewrittenText.match(new RegExp(DEFAULT_MAIN_SERVER_IP, "g")) || []).length;
      rewrittenText = rewrittenText.split(DEFAULT_MAIN_SERVER_IP).join(selectedLb);
      replacementCount += countBefore;

      // Intercept and patch server_info block in JSON response
      if (rewrittenText.trim().startsWith("{") || rewrittenText.trim().startsWith("[")) {
        try {
          const obj = JSON.parse(rewrittenText);
          if (obj && obj.server_info) {
            obj.server_info.url = selectedLb;
            obj.server_info.port = "8080";
            obj.server_info.server_protocol = "http";
            if (obj.server_info.https_port) {
              obj.server_info.https_port = "8080";
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
