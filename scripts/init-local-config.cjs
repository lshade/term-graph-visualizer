const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const slug = (process.argv[2] || "my-dictionary")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

if (!slug) {
  console.error("Usage: npm run init:local -- my-dictionary-name");
  process.exit(1);
}

const sourcePath = path.join(root, "public", "configs", "example-dictionary.json");
const targetName = `local-${slug}.json`;
const targetPath = path.join(root, "public", "configs", targetName);
const envPath = path.join(root, ".env");

if (fs.existsSync(targetPath)) {
  console.error(`Local config already exists: ${targetPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
config.title = slug
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");
config.description = "A local dictionary config. Edit terms in the UI, then click Save JSON.";

fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
fs.writeFileSync(
  envPath,
  [
    "VITE_APP_TITLE=Term Graph Visualizer",
    "VITE_HEADER_TITLE=Term Graph Visualizer",
    "VITE_HEADER_DESCRIPTION=Explore a configurable dictionary as an interactive graph.",
    `VITE_DEFAULT_CONFIG=/configs/${targetName}`,
    ""
  ].join("\n"),
  "utf8"
);

console.log(`Created ${targetPath}`);
console.log(`Updated ${envPath}`);
console.log("Run: npm run dev");
