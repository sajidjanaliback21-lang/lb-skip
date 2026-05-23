import { INITIAL_MAPPINGS, DEFAULT_MAIN_SERVER_IP } from "../src/lb-mapping.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Fallback simulation statistics for Vercel
  res.status(200).json({
    totalRequests: 142, // Simulated metrics for preview
    totalBytesProcessed: 14782910,
    activeMappingsCount: Object.keys(INITIAL_MAPPINGS).length,
    ipHits: Object.keys(INITIAL_MAPPINGS).reduce((acc, ip, idx) => {
      acc[ip] = Math.floor(Math.random() * 40) + 12; // Dynamic hit simulation for Vercel
      return acc;
    }, {}),
    recentRewrites: [
      {
        id: "vrc-1b8",
        timestamp: new Date().toISOString(),
        sourceUrl: `http://${DEFAULT_MAIN_SERVER_IP}/get.php?username=demoplay&password=demopass`,
        customDomain: "hdsj.store",
        elapsedMs: 42,
        replacements: 18,
        originalSize: 45000,
        rewrittenSize: 45280
      }
    ],
    activeMappings: INITIAL_MAPPINGS,
    defaultServer: DEFAULT_MAIN_SERVER_IP,
    isVercel: true
  });
}
