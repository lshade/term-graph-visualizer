const fs = require("node:fs");
const path = require("node:path");

const configArg = process.argv[2] || process.env.VITE_DEFAULT_CONFIG || "/configs/example-dictionary.json";
const configPath = path.join(__dirname, "..", "public", configArg.replace(/^\/+/, ""));
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const errors = [];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const categoryIds = new Set();
const sourceIds = new Set();
const termIds = new Set();

if (!config.title) errors.push("title is required");
if (!Array.isArray(config.categories) || config.categories.length === 0) errors.push("categories must be a non-empty array");
if (!Array.isArray(config.terms) || config.terms.length === 0) errors.push("terms must be a non-empty array");

for (const category of config.categories || []) {
  if (!slugPattern.test(category.id || "")) errors.push(`invalid category id: ${category.id}`);
  if (!category.label) errors.push(`category ${category.id} is missing label`);
  if (!category.color) errors.push(`category ${category.id} is missing color`);
  categoryIds.add(category.id);
}

for (const source of config.sources || []) {
  if (!slugPattern.test(source.id || "")) errors.push(`invalid source id: ${source.id}`);
  if (!source.title) errors.push(`source ${source.id} is missing title`);
  sourceIds.add(source.id);
}

for (const term of config.terms || []) {
  if (!slugPattern.test(term.id || "")) errors.push(`invalid term id: ${term.id}`);
  if (!term.title) errors.push(`term ${term.id} is missing title`);
  if (!categoryIds.has(term.category)) errors.push(`term ${term.id} uses unknown category: ${term.category}`);
  if (term.aliases && !Array.isArray(term.aliases)) errors.push(`term ${term.id} aliases must be an array`);
  if (termIds.has(term.id)) errors.push(`duplicate term id: ${term.id}`);
  termIds.add(term.id);
}

for (const term of config.terms || []) {
  for (const related of term.related || []) {
    if (!termIds.has(related)) errors.push(`term ${term.id} relates to unknown term: ${related}`);
  }
  for (const sourceId of term.sourceIds || []) {
    if (!sourceIds.has(sourceId)) errors.push(`term ${term.id} references unknown source: ${sourceId}`);
  }
}

for (const edge of config.edges || []) {
  if (!termIds.has(edge.source)) errors.push(`edge source not found: ${edge.source}`);
  if (!termIds.has(edge.target)) errors.push(`edge target not found: ${edge.target}`);
  if (!slugPattern.test(edge.label || "")) errors.push(`edge ${edge.source}->${edge.target} has invalid label: ${edge.label}`);
}

if (config.defaultTermId && !termIds.has(config.defaultTermId)) {
  errors.push(`defaultTermId not found: ${config.defaultTermId}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Config OK: ${configPath} (${termIds.size} terms, ${categoryIds.size} categories, ${sourceIds.size} sources, ${(config.edges || []).length} typed edges)`);
