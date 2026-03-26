import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = normalize(process.argv[2]);
const port = Number(process.argv[3] ?? 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    let finalPath = filePath;
    if (!existsSync(finalPath)) {
      finalPath = join(root, "yudan-craft", "index.html");
    }
    const info = await stat(finalPath);
    if (info.isDirectory()) {
      finalPath = join(finalPath, "index.html");
    }
    res.setHeader("Content-Type", mime[extname(finalPath)] ?? "application/octet-stream");
    createReadStream(finalPath).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`listening:${port}`);
});
