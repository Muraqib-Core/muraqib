import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import { performanceMonitor } from "./middleware/performance.middleware.js";
import { applySecurityMiddleware } from "./middleware/security.middleware.js";

process.env.PORT = process.env.PORT || "3000";
process.env.STATIC_ASSETS_CACHE_MAX_AGE = process.env.STATIC_ASSETS_CACHE_MAX_AGE || "86400";
process.env.ENABLE_SERVER_COMPRESSION = process.env.ENABLE_SERVER_COMPRESSION || "true";

const app = express();
app.use(express.json());

if (process.env.ENABLE_SERVER_COMPRESSION === "true") {
  app.use(compression());
}

applySecurityMiddleware(app as Parameters<typeof applySecurityMiddleware>[0]);
app.use(performanceMonitor as Parameters<typeof app.use>[0]);

const publicDir = path.join(process.cwd(), "public");
const cacheSeconds = Number(process.env.STATIC_ASSETS_CACHE_MAX_AGE) || 86400;
app.use(express.static(publicDir, { maxAge: cacheSeconds * 1000 }));

app.get("/", (_req, res) => {
  const indexPath = path.join(publicDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
    return;
  }
  res.json({ status: "ok", message: "Muraqib server running" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`[Muraqib Server] Listening on http://localhost:${port}`);
});