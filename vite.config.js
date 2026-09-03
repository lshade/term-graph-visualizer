import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const configRoot = path.join(root, "public", "configs");

function resolveConfigPath(requestPath = "/configs/example-dictionary.json") {
  const cleanPath = requestPath.split("?")[0].replaceAll("\\", "/");
  if (!cleanPath.startsWith("/configs/") || !cleanPath.endsWith(".json")) {
    throw new Error("Config path must be a JSON file under /configs/.");
  }

  const resolved = path.resolve(configRoot, cleanPath.replace("/configs/", ""));
  if (!resolved.startsWith(configRoot + path.sep)) {
    throw new Error("Config path escapes the configs directory.");
  }

  return resolved;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

export default defineConfig({
  server: {
    hmr: false
  },
  plugins: [
    {
      name: "term-graph-config-writer",
      configureServer(server) {
        server.middlewares.use("/api/config", async (request, response) => {
          try {
            if (request.method === "GET") {
              const url = new URL(request.url || "", "http://localhost");
              const filePath = resolveConfigPath(url.searchParams.get("path") || undefined);
              sendJson(response, 200, JSON.parse(await readFile(filePath, "utf8")));
              return;
            }

            if (request.method === "POST") {
              const body = await readJsonBody(request);
              const filePath = resolveConfigPath(body.path);
              await writeFile(filePath, `${JSON.stringify(body.config, null, 2)}\n`, "utf8");
              sendJson(response, 200, { ok: true, path: body.path });
              return;
            }

            response.statusCode = 405;
            response.end("Method not allowed");
          } catch (error) {
            sendJson(response, 400, { ok: false, error: error.message });
          }
        });
        server.middlewares.use("/api/save-static", async (request, response) => {
          try {
            if (request.method !== "POST") {
              response.statusCode = 405;
              response.end("Method not allowed");
              return;
            }

            const body = await readJsonBody(request);
            const filename = path.basename(String(body.filename || "term-graph.html")).replace(/[<>:"/\\|?*]/g, "-");
            if (!filename.endsWith(".html")) {
              throw new Error("Static export filename must end with .html.");
            }
            if (typeof body.html !== "string" || !body.html.trim().startsWith("<!doctype html>")) {
              throw new Error("Static export HTML is missing or invalid.");
            }

            const downloads = path.join(os.homedir(), "Downloads");
            await mkdir(downloads, { recursive: true });
            const filePath = path.join(downloads, filename);
            await writeFile(filePath, body.html, "utf8");
            sendJson(response, 200, { ok: true, path: filePath, filename });
          } catch (error) {
            sendJson(response, 400, { ok: false, error: error.message });
          }
        });
      }
    }
  ]
});
