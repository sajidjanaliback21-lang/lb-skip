// Vercel Serverless Function - Abandoned stream proxy
// Returning 404 for all media routes to prevent resource usage/load balancer proxying

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  return res.status(404).send("Not Found");
}
