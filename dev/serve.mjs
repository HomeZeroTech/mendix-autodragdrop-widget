// A minimal static file server for the development harness. Serves the widget project folder.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 4173;
const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
};

http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.normalize(path.join(root, pathname === "/" ? "/dev/harness.html" : pathname));
    if (!file.startsWith(root)) {
        response.writeHead(403).end();
        return;
    }
    fs.readFile(file, (error, data) => {
        if (error) {
            response.writeHead(404).end("Not found");
            return;
        }
        response.writeHead(200, {
            "Content-Type": types[path.extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store"
        });
        response.end(data);
    });
}).listen(port, () => console.log(`Harness on http://localhost:${port}/dev/harness.html`));
