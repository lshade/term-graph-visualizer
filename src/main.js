import "./styles.css";

const APP_TITLE = import.meta.env.VITE_APP_TITLE || "Term Graph Visualizer";
const HEADER_TITLE = import.meta.env.VITE_HEADER_TITLE || "";
const HEADER_DESCRIPTION = import.meta.env.VITE_HEADER_DESCRIPTION || "";
const DEFAULT_CONFIG = import.meta.env.VITE_DEFAULT_CONFIG || "/configs/example-dictionary.json";
const TERMS_PAGE_SIZE = 10;
const MIN_FIT_SCALE = 0.08;
const GRAPH_INITIAL_RADIUS = 210;
const GRAPH_OUTLIER_RADIUS = 520;
const STATIC_MODE = Boolean(globalThis.__TERM_GRAPH_STATIC__) || Boolean(document.getElementById("term-graph-data"));
const FALLBACK_CATEGORY = {
  id: "uncategorized",
  label: "Uncategorized",
  color: "--cp-text-muted"
};

const state = {
  activeId: "",
  category: "all",
  configPath: DEFAULT_CONFIG,
  leftCollapsed: true,
  leftMode: "browse",
  rightCollapsed: false,
  showAllLabels: false,
  termPage: 0,
  query: "",
  paused: false,
  hoverId: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  fitScale: 1,
  rotationX: -0.42,
  rotationY: 0.78,
  autoRotate: true
};

let config = null;
let categories = [];
let categoryById = new Map();
let sources = [];
let sourceById = new Map();
let terms = [];
let termById = new Map();
let links = [];
let nodes = [];
let nodeById = new Map();
let visibleNodes = [];
let visibleLinks = [];
let width = 0;
let height = 0;
let pointer = { x: 0, y: 0, down: false, moved: false, node: null };
let canvas = null;
let ctx = null;
let search = null;
let staticExportAssets = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeConfig(rawConfig) {
  if (!rawConfig || !Array.isArray(rawConfig.terms) || rawConfig.terms.length === 0) {
    throw new Error("Config must include a non-empty terms array.");
  }

  const normalizedCategories = Array.isArray(rawConfig.categories) ? [...rawConfig.categories] : [];
  const categoryIds = new Set(normalizedCategories.map((item) => item.id));
  const normalizedSources = Array.isArray(rawConfig.sources)
    ? rawConfig.sources.map((source) => ({
        id: source.id,
        title: source.title,
        type: source.type || "",
        url: source.url || "",
        notes: source.notes || ""
      }))
    : [];
  const sourceIds = new Set(normalizedSources.map((source) => source.id));
  const normalizedTerms = rawConfig.terms.map((term) => ({
    id: term.id,
    title: term.title,
    category: categoryIds.has(term.category) ? term.category : FALLBACK_CATEGORY.id,
    summary: term.summary || "",
    details: term.details || "",
    aliases: Array.isArray(term.aliases) ? term.aliases : [],
    related: Array.isArray(term.related) ? term.related : [],
    sourceIds: Array.isArray(term.sourceIds) ? term.sourceIds.filter((sourceId) => sourceIds.has(sourceId)) : []
  }));

  if (normalizedTerms.some((term) => !term.id || !term.title)) {
    throw new Error("Every term must include id and title.");
  }
  if (normalizedSources.some((source) => !source.id || !source.title)) {
    throw new Error("Every source must include id and title.");
  }

  if (normalizedTerms.some((term) => term.category === FALLBACK_CATEGORY.id) && !categoryIds.has(FALLBACK_CATEGORY.id)) {
    normalizedCategories.push(FALLBACK_CATEGORY);
  }

  return {
    title: rawConfig.title || APP_TITLE,
    eyebrow: rawConfig.eyebrow || "Interactive vocabulary map",
    sidebarEyebrow: rawConfig.sidebarEyebrow || "Dictionary config",
    description: rawConfig.description || "Explore a configurable vocabulary map as connected terms.",
    instructions:
      rawConfig.instructions ||
      "Explore the vocabulary as connected terms. Search, filter, drag nodes, and click a term to read the definition.",
    searchPlaceholder: rawConfig.searchPlaceholder || "Search terms...",
    defaultTermId: rawConfig.defaultTermId || normalizedTerms[0].id,
    categories: normalizedCategories,
    sources: normalizedSources,
    terms: normalizedTerms,
    edges: Array.isArray(rawConfig.edges)
      ? rawConfig.edges.map((edge) => ({
          source: edge.source,
          label: edge.label || "related",
          target: edge.target
        }))
      : []
  };
}

async function loadConfig() {
  const staticData = document.getElementById("term-graph-data");
  if (staticData) {
    return normalizeConfig(JSON.parse(staticData.textContent));
  }

  if (globalThis.__TERM_GRAPH_DATA__) {
    return normalizeConfig(globalThis.__TERM_GRAPH_DATA__);
  }

  const params = new URLSearchParams(window.location.search);
  const configPath = params.get("config") || DEFAULT_CONFIG;
  state.configPath = configPath;
  const response = await fetch(configPath);
  if (!response.ok) {
    throw new Error(`Could not load config: ${configPath}`);
  }
  return normalizeConfig(await response.json());
}

function initializeGraph(nextConfig) {
  config = nextConfig;
  categories = config.categories;
  categoryById = new Map(categories.map((item) => [item.id, item]));
  sources = config.sources || [];
  sourceById = new Map(sources.map((source) => [source.id, source]));
  terms = config.terms;
  termById = new Map(terms.map((term) => [term.id, term]));
  const fallbackRelatedLinks = terms.flatMap((term) =>
    term.related
      .filter((relatedId) => termById.has(relatedId))
      .map((relatedId) => ({ source: term.id, target: relatedId, label: "related" }))
  );
  const typedLinks = Array.isArray(config.edges)
    ? config.edges
        .filter((edge) => termById.has(edge.source) && termById.has(edge.target))
        .map((edge) => ({ source: edge.source, target: edge.target, label: edge.label || "related" }))
    : [];
  const dedupedLinks = new Map();
  const sourceLinks = typedLinks.length > 0 ? typedLinks : fallbackRelatedLinks;
  for (const link of sourceLinks) {
    dedupedLinks.set(`${link.source}|${link.target}|${link.label}`, link);
  }
  links = [...dedupedLinks.values()];
  const degreeById = new Map(terms.map((term) => [term.id, 0]));
  for (const link of links) {
    degreeById.set(link.source, (degreeById.get(link.source) || 0) + 1);
    degreeById.set(link.target, (degreeById.get(link.target) || 0) + 1);
  }
  const maxDegree = Math.max(1, ...degreeById.values());
  nodes = terms.map((term, index) => {
    const degree = degreeById.get(term.id) || 0;
    const direction = sphericalPoint(index, terms.length, 1);
    const spreadRank = ((index * 37) % terms.length + 0.5) / terms.length;
    const spreadRadius = 46 + Math.sqrt(spreadRank) * GRAPH_INITIAL_RADIUS;
    const centrality = degree / maxDegree;
    const initialRadius = term.id === config.defaultTermId ? 52 : spreadRadius * (1 - centrality * 0.45);
    return {
      ...term,
      degree,
      x: direction.x * initialRadius,
      y: direction.y * initialRadius,
      z: direction.z * initialRadius,
      vx: 0,
      vy: 0,
      vz: 0
    };
  });
  nodeById = new Map(nodes.map((node) => [node.id, node]));
  state.activeId = termById.has(config.defaultTermId) ? config.defaultTermId : terms[0].id;
}

function sphericalPoint(index, total, radius) {
  const offset = 2 / total;
  const increment = Math.PI * (3 - Math.sqrt(5));
  const y = index * offset - 1 + offset / 2;
  const r = Math.sqrt(1 - y * y);
  const phi = index * increment;
  return {
    x: Math.cos(phi) * r * radius,
    y: y * radius,
    z: Math.sin(phi) * r * radius
  };
}

function rebuildGraph(activeId = state.activeId) {
  initializeGraph(config);
  state.activeId = termById.has(activeId) ? activeId : config.defaultTermId;
  resize();
  fitGraph();
  filterGraph();
  renderDetails();
}

function commandIcon(name) {
  const icons = {
    reset:
      '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5.05 5.05A7 7 0 1 1 3 10a.5.5 0 0 1 1 0 6 6 0 1 0 1.76-4.24L4.5 7H8a.5.5 0 0 1 0 1H3.3a.5.5 0 0 1-.5-.5V2.8a.5.5 0 0 1 1 0v3.5l1.25-1.25Z"/></svg>',
    pause:
      '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M6.5 4C5.67 4 5 4.67 5 5.5v9c0 .83.67 1.5 1.5 1.5S8 15.33 8 14.5v-9C8 4.67 7.33 4 6.5 4Zm7 0c-.83 0-1.5.67-1.5 1.5v9c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5Z"/></svg>',
    play:
      '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5.5 4.9c0-.78.85-1.26 1.52-.86l8.5 5.1a1 1 0 0 1 0 1.72l-8.5 5.1a1 1 0 0 1-1.52-.86V4.9Z"/></svg>',
    fit:
      '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v3a.5.5 0 0 0 1 0v-3c0-.28.22-.5.5-.5h3a.5.5 0 0 0 0-1h-3Zm8 0a.5.5 0 0 0 0 1h3c.28 0 .5.22.5.5v3a.5.5 0 0 0 1 0v-3A1.5 1.5 0 0 0 15.5 3h-3ZM3.5 12a.5.5 0 0 0-.5.5v3A1.5 1.5 0 0 0 4.5 17h3a.5.5 0 0 0 0-1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 0-.5-.5Zm13 0a.5.5 0 0 0-.5.5v3a.5.5 0 0 1-.5.5h-3a.5.5 0 0 0 0 1h3a1.5 1.5 0 0 0 1.5-1.5v-3a.5.5 0 0 0-.5-.5Z"/></svg>',
    labels:
      '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 5.5C3 4.67 3.67 4 4.5 4h11c.83 0 1.5.67 1.5 1.5v2c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 3 7.5v-2ZM4.5 5a.5.5 0 0 0-.5.5v2c0 .28.22.5.5.5h11a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-11ZM5 12.5c0-.28.22-.5.5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5Zm2 3c0-.28.22-.5.5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5Z"/></svg>'
  };
  return icons[name] || "";
}

function renderShell() {
  const headerTitle = HEADER_TITLE || APP_TITLE;
  const headerDescription = HEADER_DESCRIPTION || "Explore a configurable dictionary as an interactive graph.";
  document.title = headerTitle;
  document.querySelector("#app").innerHTML = `
    <div class="app-frame">
      <header class="topbar">
        <div>
          <h1>${escapeHtml(headerTitle)}</h1>
          <p>${escapeHtml(headerDescription)} <span class="dictionary-context">Dictionary: ${escapeHtml(config.title)}</span></p>
        </div>
        <div id="appStatus" class="app-status" role="status" aria-live="polite"></div>
        <div class="button-row">
          <button id="reset" class="icon-button" type="button" aria-label="Reset view" title="Reset view">${commandIcon("reset")}</button>
          <button id="pause" class="icon-button" type="button" aria-label="Pause motion" title="Pause motion">${commandIcon("pause")}</button>
          <button id="fit" class="icon-button" type="button" aria-label="Fit graph" title="Fit graph">${commandIcon("fit")}</button>
          <button id="toggleLabels" class="icon-button" type="button" aria-label="Show all labels" title="Show all labels">${commandIcon("labels")}</button>
          <button id="theme" class="icon-button" type="button" aria-label="Toggle theme" title="Toggle theme">☀</button>
          ${
            STATIC_MODE
              ? ""
              : `<button id="downloadStatic" class="icon-button" type="button" aria-label="Download static HTML" title="Download static HTML">
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M10 2.5c.28 0 .5.22.5.5v7.8l2.65-2.65a.5.5 0 0 1 .7.7l-3.5 3.5a.5.5 0 0 1-.7 0l-3.5-3.5a.5.5 0 1 1 .7-.7L9.5 10.8V3c0-.28.22-.5.5-.5ZM4 13.5c.28 0 .5.22.5.5v1.5h11V14a.5.5 0 0 1 1 0v2c0 .28-.22.5-.5.5H4a.5.5 0 0 1-.5-.5v-2c0-.28.22-.5.5-.5Z" />
            </svg>
          </button>`
          }
        </div>
      </header>

      <div class="legend-row">
        <button class="legend-scroll legend-scroll-left" type="button" aria-label="Scroll categories left" title="Scroll categories left">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
        </button>
        <div class="legend-strip" aria-label="Category legend">
          <button class="legend-item category-chip" type="button" data-category-filter="all">
            <span>All</span>
          </button>
          ${categories
            .map(
              (item) => `
                <button class="legend-item category-chip" type="button" data-category-filter="${escapeHtml(item.id)}">
                  <span class="dot" style="--dot-color: var(${escapeHtml(item.color)})"></span>
                  <span>${escapeHtml(item.label)}</span>
                </button>
              `
            )
            .join("")}
        </div>
        <button class="legend-scroll legend-scroll-right" type="button" aria-label="Scroll categories right" title="Scroll categories right">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7.5 4.5 13 10l-5.5 5.5" /></svg>
        </button>
      </div>
      <div class="search-strip">
        <label class="field search-field">
          <span>Search terms</span>
          <input id="search" type="search" placeholder="${escapeHtml(config.searchPlaceholder)}" autocomplete="off" />
        </label>
      </div>

      <div class="shell">
        <aside class="sidebar pane">
          <div class="pane-rail">
            <button class="rail-button" type="button" data-left-mode="browse" aria-label="Browse dictionary" title="Browse dictionary">
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M5 5.5h10M5 10h10M5 14.5h10" />
              </svg>
            </button>
            <button class="rail-button" type="button" data-left-mode="edit" aria-label="Edit selected term" title="Edit selected term">
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M4.5 14.5 5 11l7.8-7.8a1.7 1.7 0 0 1 2.4 2.4L7.4 13.4 4.5 14.5Z" />
                <path d="M11.8 4.2 14.8 7.2" />
              </svg>
            </button>
          </div>
          <div class="pane-content"></div>
        </aside>

        <section class="stage">
          <div class="canvas-wrap">
            <canvas id="graph"></canvas>
            <div class="hint">Drag empty space to rotate. Wheel zooms. <span class="kbd">/</span> searches.</div>
          </div>
        </section>

        <aside class="details pane">
          <div class="pane-rail">
            <button id="toggleRight" class="panel-toggle" type="button" aria-label="Hide details panel"></button>
          </div>
          <div class="pane-content" id="details"></div>
        </aside>
      </div>
    </div>
  `;

  canvas = document.querySelector("#graph");
  ctx = canvas.getContext("2d");
  search = document.querySelector("#search");

  bindEvents();
  applyPanelState();
  renderCategoryChips();
  renderLeftPane();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function categoryColor(categoryId) {
  return cssVar(categoryById.get(categoryId)?.color || FALLBACK_CATEGORY.color);
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const ratio = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
  width = rect.width;
  height = rect.height;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return true;
}

function project(node) {
  const rotated = rotatePoint(node.x, node.y, node.z);
  const depth = 950 / (950 + rotated.z * 0.45);
  return {
    x: width / 2 + state.offsetX + rotated.x * depth * state.scale,
    y: height / 2 + state.offsetY + rotated.y * depth * state.scale,
    z: rotated.z,
    r: Math.max(4, (6 + Math.sqrt(node.degree || 1) * 1.8 + depth * 1.8) * state.scale),
    depth: Math.max(0.72, Math.min(1.24, depth))
  };
}

function rotatePoint(x, y, z) {
  const cosY = Math.cos(state.rotationY);
  const sinY = Math.sin(state.rotationY);
  const cosX = Math.cos(state.rotationX);
  const sinX = Math.sin(state.rotationX);
  const x1 = x * cosY - z * sinY;
  const z1 = x * sinY + z * cosY;
  const y1 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;
  return {
    x: x1,
    y: y1,
    z: z2
  };
}

function filterGraph() {
  const query = state.query.trim().toLowerCase();
  const matchedNodes = nodes.filter((node) => {
    const matchesCategory = state.category === "all" || node.category === state.category;
    const text = `${node.id} ${node.title} ${(node.aliases || []).join(" ")} ${node.summary} ${node.details}`.toLowerCase();
    return matchesCategory && (!query || text.includes(query));
  });

  if (query) {
    const matchedIds = new Set(matchedNodes.map((node) => node.id));
    const expandedIds = new Set(matchedIds);
    for (const link of links) {
      if (matchedIds.has(link.source)) expandedIds.add(link.target);
      if (matchedIds.has(link.target)) expandedIds.add(link.source);
    }
    visibleNodes = nodes.filter((node) => expandedIds.has(node.id));
  } else {
    visibleNodes = matchedNodes;
  }

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  visibleLinks = links.filter((link) => {
    if (!visibleIds.has(link.source) || !visibleIds.has(link.target)) return false;
    return !query || matchedNodes.some((node) => node.id === link.source || node.id === link.target);
  });
  state.termPage = Math.min(state.termPage, Math.max(0, Math.ceil(visibleNodes.length / TERMS_PAGE_SIZE) - 1));

  const termCount = document.querySelector("#termCount");
  const linkCount = document.querySelector("#linkCount");
  if (termCount) termCount.textContent = visibleNodes.length;
  if (linkCount) linkCount.textContent = visibleLinks.length;
  renderLeftPane();
  renderCategoryChips();
}

function renderCategoryChips() {
  document.querySelectorAll("[data-category-filter]").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.categoryFilter === state.category);
  });
}

function tick() {
  if (state.paused) {
    return;
  }

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  for (let i = 0; i < visibleNodes.length; i++) {
    for (let j = i + 1; j < visibleNodes.length; j++) {
      const a = visibleNodes[i];
      const b = visibleNodes[j];
      const dx = a.x - b.x || 0.01;
      const dy = a.y - b.y || 0.01;
      const dz = a.z - b.z || 0.01;
      const dist2 = dx * dx + dy * dy + dz * dz;
      const force = Math.min(4200 / dist2, 0.9);
      a.vx += dx * force * 0.007;
      a.vy += dy * force * 0.007;
      a.vz += dz * force * 0.007;
      b.vx -= dx * force * 0.007;
      b.vy -= dy * force * 0.007;
      b.vz -= dz * force * 0.007;
    }
  }

  for (const link of visibleLinks) {
    const a = nodeById.get(link.source);
    const b = nodeById.get(link.target);
    if (!a || !b || !visibleIds.has(a.id) || !visibleIds.has(b.id)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dy, dz) || 1;
    const desired = 105;
    const force = (distance - desired) * 0.0038;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    const fz = (dz / distance) * force;
    a.vx += fx;
    a.vy += fy;
    a.vz += fz;
    b.vx -= fx;
    b.vy -= fy;
    b.vz -= fz;
  }

  for (const node of visibleNodes) {
    const radius = Math.hypot(node.x, node.y, node.z) || 1;
    const centerGravity = node.id === config.defaultTermId ? 0.00034 : 0.00018;
    node.vx -= node.x * centerGravity;
    node.vy -= node.y * centerGravity;
    node.vz -= node.z * centerGravity;
    if (radius > GRAPH_OUTLIER_RADIUS) {
      const outlierForce = (radius - GRAPH_OUTLIER_RADIUS) * 0.0022;
      node.vx -= (node.x / radius) * outlierForce;
      node.vy -= (node.y / radius) * outlierForce;
      node.vz -= (node.z / radius) * outlierForce;
    }
    node.vx *= 0.88;
    node.vy *= 0.88;
    node.vz *= 0.88;
    if (pointer.node?.id !== node.id) {
      node.x += node.vx;
      node.y += node.vy;
      node.z += node.vz;
    }
  }

  if (state.autoRotate && !pointer.down) {
    state.rotationY += 0.0018;
  }
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  const text = cssVar("--cp-text");
  const muted = cssVar("--cp-text-muted");
  const border = cssVar("--cp-border");
  const borderStrong = cssVar("--cp-border-strong");
  const highlight = cssVar("--cp-highlight");

  const active = nodeById.get(state.activeId);
  const activeRelated = new Set(active ? [active.id, ...active.related, ...getRelationships(active.id).map((item) => item.term.id)] : []);

  for (const link of visibleLinks) {
    const a = nodeById.get(link.source);
    const b = nodeById.get(link.target);
    const pa = project(a);
    const pb = project(b);
    const important = activeRelated.has(a.id) && activeRelated.has(b.id);

    const depth = Math.max(0.2, Math.min(1.3, (pa.depth + pb.depth) / 2));
    ctx.strokeStyle = important ? borderStrong : border;
    ctx.lineWidth = important ? 2.25 : 1.15;
    ctx.globalAlpha = important ? 0.56 + depth * 0.18 : 0.1 + depth * 0.08;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const sorted = [...visibleNodes].sort((a, b) => project(a).z - project(b).z);
  const labelBudget = state.showAllLabels ? visibleNodes.length : 0;
  for (const node of sorted) {
    const p = project(node);
    const selected = node.id === state.activeId;
    const hovered = node.id === state.hoverId;
    const connected = activeRelated.has(node.id);

    ctx.beginPath();
    ctx.fillStyle = selected || hovered ? highlight : cssVar("--cp-surface");
    ctx.arc(p.x, p.y, p.r + (selected ? 13 : hovered ? 9 : 6), 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = categoryColor(node.category);
    ctx.arc(p.x, p.y, p.r + (selected ? 3 : 0), 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = selected ? borderStrong : connected ? borderStrong : border;
    ctx.lineWidth = selected ? 3 : 1;
    ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
    ctx.stroke();

    const shouldLabel = selected || hovered || (connected && !state.showAllLabels) || labelBudget > 0;
    if (shouldLabel) {
      ctx.globalAlpha = Math.max(0.34, Math.min(1, p.depth));
      ctx.fillStyle = selected || hovered ? text : muted;
      ctx.font = `${selected ? 700 : 600} ${selected ? 15 : 11}px "Segoe UI", Aptos, Calibri, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      wrapLabel(node.title, p.x, p.y + p.r + 10, selected ? 112 : 78, selected ? 18 : 14);
    }
    ctx.globalAlpha = 1;
  }

}

function wrapLabel(label, x, y, maxWidth, lineHeight) {
  const words = label.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  lines.slice(0, 2).forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
}

function renderDetails() {
  const term = termById.get(state.activeId) || terms[0];
  const termCategory = categoryById.get(term.category) || FALLBACK_CATEGORY;
  const relationships = getRelationships(term.id);
  const references = getReferences(term);
  document.querySelector("#details").innerHTML = `
    <div class="term-title">
      <div>
        <p class="eyebrow">Selected term</p>
        <h2>${escapeHtml(term.title)}</h2>
      </div>
      <span class="category-pill">
        <span class="dot" style="--dot-color: var(${escapeHtml(termCategory.color)})"></span>
        ${escapeHtml(termCategory.label)}
      </span>
    </div>
    <p class="summary">${escapeHtml(term.summary)}</p>
    <p class="details-text">${escapeHtml(term.details)}</p>
    <h3>References</h3>
    <div class="reference-list">
      ${
        references.length > 0
          ? references
              .map(
                (source) => `
                  <div class="reference-card" title="${escapeHtml(source.notes || "")}">
                    <strong>${escapeHtml(source.title)}</strong>
                    <div class="muted">${escapeHtml(source.type || "Source")}</div>
                    ${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}
                  </div>
                `
              )
              .join("")
          : '<div class="empty">No references captured for this term yet.</div>'
      }
    </div>
    <h3>Relationships</h3>
    <div class="related-list">
      ${relationships
        .map(({ term: related, label, direction }) => {
          const relatedCategory = categoryById.get(related.category) || FALLBACK_CATEGORY;
          return `
            <button class="related-card" type="button" data-id="${escapeHtml(related.id)}">
              <strong>${escapeHtml(related.title)}</strong>
              <div class="muted">${escapeHtml(direction === "out" ? label : `${label} by`)} - ${escapeHtml(relatedCategory.label)}</div>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
  renderLeftPane();
}

function getReferences(term) {
  return (term.sourceIds || []).map((sourceId) => sourceById.get(sourceId)).filter(Boolean);
}

function getRelationships(termId) {
  const results = [];
  const seen = new Set();
  for (const link of links) {
    if (link.source === termId && termById.has(link.target)) {
      const key = `${link.target}|${link.label}|out`;
      if (!seen.has(key)) {
        results.push({ term: termById.get(link.target), label: link.label, direction: "out" });
        seen.add(key);
      }
    } else if (link.target === termId && termById.has(link.source)) {
      const key = `${link.source}|${link.label}|in`;
      if (!seen.has(key)) {
        results.push({ term: termById.get(link.source), label: link.label, direction: "in" });
        seen.add(key);
      }
    }
  }
  return results.sort((a, b) => a.label.localeCompare(b.label) || a.term.title.localeCompare(b.term.title));
}

function renderLeftPane() {
  const pane = document.querySelector(".sidebar .pane-content");
  if (!pane) return;

  if (!pane.dataset.initialized) {
    pane.innerHTML = `
      <section class="left-view browse-view"></section>
      <section class="left-view edit-view"></section>
    `;
    pane.dataset.initialized = "true";
  }

  pane.querySelector(".browse-view").hidden = state.leftMode !== "browse";
  pane.querySelector(".edit-view").hidden = state.leftMode !== "edit";

  if (state.leftMode === "edit") {
    renderEditor();
  } else {
    renderTermList();
  }
}

function renderLeftHeader(mode) {
  return `
    <p class="eyebrow">${escapeHtml(mode === "edit" ? "Term editor" : config.sidebarEyebrow)}</p>
    <h2>${mode === "edit" ? "Edit selected term" : "Dictionary"}</h2>
    <p class="muted">${escapeHtml(
      mode === "edit"
        ? "Edit the selected term, save the JSON config, or create a new term."
        : "Browse the filtered terms. Use the top search and category chips to narrow the dictionary."
    )}</p>
  `;
}

function renderTermList() {
  const view = document.querySelector(".browse-view");
  if (!view) return;

  const pageCount = Math.max(1, Math.ceil(visibleNodes.length / TERMS_PAGE_SIZE));
  const pageStart = state.termPage * TERMS_PAGE_SIZE;
  const pageTerms = visibleNodes.slice(pageStart, pageStart + TERMS_PAGE_SIZE);
  const list = pageTerms
    .map(
      (term) => `
        <button class="term-card ${term.id === state.activeId ? "active" : ""}" type="button" data-id="${escapeHtml(term.id)}">
          <strong>${escapeHtml(term.title)}</strong>
          <span>${escapeHtml(term.summary)}</span>
        </button>
      `
    )
    .join("");

  view.innerHTML = `
    ${renderLeftHeader("browse")}
    <section class="term-browser">
      <div class="term-list">${list || '<div class="empty">No terms match the current filter.</div>'}</div>
      <div class="pagination">
        <button id="prevTerms" type="button" ${state.termPage === 0 ? "disabled" : ""}>Previous</button>
        <span>${visibleNodes.length === 0 ? "0 of 0" : `${pageStart + 1}-${Math.min(pageStart + TERMS_PAGE_SIZE, visibleNodes.length)} of ${visibleNodes.length}`}</span>
        <button id="nextTerms" type="button" ${state.termPage >= pageCount - 1 ? "disabled" : ""}>Next</button>
      </div>
    </section>
  `;
}

function renderEditor() {
  const view = document.querySelector(".edit-view");
  const term = termById.get(state.activeId);
  if (!view || !term) return;

  view.innerHTML = `
    ${renderLeftHeader("edit")}
    <section class="term-editor">
      <div class="section-header">
        <div class="button-row">
          <button id="addTerm" type="button">New</button>
          <button id="saveConfig" type="button">Save JSON</button>
        </div>
      </div>
      <p class="save-status muted" id="saveStatus">Editing ${escapeHtml(state.configPath)}</p>
      <label class="field">
        <span>Title</span>
        <input id="editTitle" value="${escapeHtml(term.title)}" />
      </label>
      <label class="field">
        <span>ID</span>
        <input id="editId" value="${escapeHtml(term.id)}" />
      </label>
      <label class="field">
        <span>Category</span>
        <select id="editCategory">
          ${categories
            .map(
              (item) =>
                `<option value="${escapeHtml(item.id)}" ${item.id === term.category ? "selected" : ""}>${escapeHtml(item.label)}</option>`
            )
            .join("")}
        </select>
      </label>
      <label class="field">
        <span>Summary</span>
        <textarea id="editSummary" rows="3">${escapeHtml(term.summary)}</textarea>
      </label>
      <label class="field">
        <span>Acronyms and aliases, comma-separated</span>
        <textarea id="editAliases" rows="2">${escapeHtml((term.aliases || []).join(", "))}</textarea>
      </label>
      <label class="field">
        <span>Details</span>
        <textarea id="editDetails" rows="5">${escapeHtml(term.details)}</textarea>
      </label>
      <label class="field">
        <span>Related term IDs, comma-separated</span>
        <textarea id="editRelated" rows="3">${escapeHtml(term.related.join(", "))}</textarea>
      </label>
      <div class="source-picker">
        <span>References</span>
        ${renderSourcePicker(term)}
        <details class="add-source">
          <summary>Add a new reference</summary>
          <label class="field">
            <span>Reference title</span>
            <input id="newSourceTitle" placeholder="Architecture deck, workshop notes, meeting transcript..." />
          </label>
          <label class="field">
            <span>Type</span>
            <input id="newSourceType" placeholder="PowerPoint deck, meeting transcript, document..." />
          </label>
          <label class="field">
            <span>URL</span>
            <input id="newSourceUrl" placeholder="Optional link" />
          </label>
          <label class="field">
            <span>Notes</span>
            <textarea id="newSourceNotes" rows="2" placeholder="Optional short note about what this source supports"></textarea>
          </label>
          <button id="addSource" type="button">Add reference</button>
        </details>
      </div>
      <div class="button-row editor-actions">
        <button id="applyTerm" type="button" class="primary">Apply edit</button>
        <button id="deleteTerm" type="button">Delete term</button>
      </div>
    </section>
  `;
}

function renderSourcePicker(term) {
  if (sources.length === 0) {
    return '<div class="empty">No sources are defined for this dictionary.</div>';
  }

  const selected = new Set(term.sourceIds || []);
  return sources
    .map(
      (source) => `
        <label class="source-option">
          <input type="checkbox" value="${escapeHtml(source.id)}" ${selected.has(source.id) ? "checked" : ""} />
          <span>
            <strong>${escapeHtml(source.title)}</strong>
            <span>${escapeHtml(source.type || "Source")}</span>
          </span>
        </label>
      `
    )
    .join("");
}

function uniqueSourceId(title) {
  const base = slugify(title || "source");
  let candidate = base;
  let index = 2;
  while (sourceById.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function addSourceFromEditor() {
  const title = document.querySelector("#newSourceTitle")?.value.trim();
  if (!title) {
    setSaveStatus("Reference title is required.", true);
    return;
  }

  const source = {
    id: uniqueSourceId(title),
    title,
    type: document.querySelector("#newSourceType")?.value.trim() || "Source",
    url: document.querySelector("#newSourceUrl")?.value.trim() || "",
    notes: document.querySelector("#newSourceNotes")?.value.trim() || ""
  };

  config.sources = [...(config.sources || []), source];
  const term = config.terms.find((item) => item.id === state.activeId);
  if (term) {
    term.sourceIds = [...new Set([...(term.sourceIds || []), source.id])];
  }
  initializeGraph(config);
  renderDetails();
  renderLeftPane();
  applyPanelState();
  setSaveStatus("Reference added locally. Click Save JSON to persist.");
}

function slugify(value) {
  return String(value || "new-term")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "new-term";
}

function uniqueId(baseId, exceptId = "") {
  const base = slugify(baseId);
  let candidate = base;
  let index = 2;
  while (termById.has(candidate) && candidate !== exceptId) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function updateSelectedTermFromEditor() {
  const current = termById.get(state.activeId);
  if (!current) return null;
  if (!document.querySelector("#editId")) return current;

  const nextId = uniqueId(document.querySelector("#editId").value, current.id);
  const related = document
    .querySelector("#editRelated")
    .value.split(",")
    .map((item) => slugify(item))
    .filter((item) => item && item !== nextId);
  const sourceIds = Array.from(document.querySelectorAll(".source-option input:checked"))
    .map((input) => input.value)
    .filter((item) => sourceById.has(item));
  const aliases = document
    .querySelector("#editAliases")
    .value.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const updated = {
    id: nextId,
    title: document.querySelector("#editTitle").value.trim() || current.title,
    category: document.querySelector("#editCategory").value,
    summary: document.querySelector("#editSummary").value.trim(),
    details: document.querySelector("#editDetails").value.trim(),
    aliases: [...new Set(aliases)],
    related: [...new Set(related)],
    sourceIds: [...new Set(sourceIds)]
  };

  config.terms = config.terms.map((term) => (term.id === current.id ? updated : term));
  config.terms = config.terms.map((term) => ({
    ...term,
    related: term.related.map((id) => (id === current.id ? nextId : id))
  }));
  if (Array.isArray(config.edges)) {
    config.edges = config.edges.map((edge) => ({
      ...edge,
      source: edge.source === current.id ? nextId : edge.source,
      target: edge.target === current.id ? nextId : edge.target
    }));
  }
  if (config.defaultTermId === current.id) {
    config.defaultTermId = nextId;
  }
  rebuildGraph(nextId);
  setSaveStatus("Applied locally. Click Save JSON to persist.");
  return updated;
}

function addTerm() {
  const categoryId = categories[0]?.id || FALLBACK_CATEGORY.id;
  const id = uniqueId("new-term");
  state.query = "";
  state.category = "all";
  if (search) search.value = "";
  state.leftMode = "edit";
  state.leftCollapsed = false;
  config.terms.push({
    id,
    title: "New term",
    category: categoryId,
    summary: "Short definition.",
    details: "Add the details for this term.",
    aliases: [],
    related: [],
    sourceIds: []
  });
  rebuildGraph(id);
  const termIndex = visibleNodes.findIndex((term) => term.id === id);
  state.termPage = termIndex >= 0 ? Math.floor(termIndex / TERMS_PAGE_SIZE) : 0;
  renderLeftPane();
  applyPanelState();
  setSaveStatus("New term added locally. Click Save JSON to persist.");
}

function deleteSelectedTerm() {
  if (config.terms.length <= 1) {
    setSaveStatus("Keep at least one term in the dictionary.", true);
    return;
  }

  const deletedId = state.activeId;
  config.terms = config.terms
    .filter((term) => term.id !== deletedId)
    .map((term) => ({ ...term, related: term.related.filter((id) => id !== deletedId) }));
  if (Array.isArray(config.edges)) {
    config.edges = config.edges.filter((edge) => edge.source !== deletedId && edge.target !== deletedId);
  }
  if (config.defaultTermId === deletedId) {
    config.defaultTermId = config.terms[0].id;
  }
  rebuildGraph(config.defaultTermId);
  setSaveStatus("Term deleted locally. Click Save JSON to persist.");
}

function setSaveStatus(message, isError = false) {
  const element = document.querySelector("#saveStatus");
  if (element) {
    element.textContent = message;
    element.classList.toggle("error", isError);
  }
  const appStatus = document.querySelector("#appStatus");
  if (appStatus) {
    appStatus.textContent = message;
    appStatus.classList.toggle("error", isError);
    window.clearTimeout(setSaveStatus.timeoutId);
    setSaveStatus.timeoutId = window.setTimeout(() => {
      appStatus.textContent = "";
      appStatus.classList.remove("error");
    }, 5000);
  }
}

function applyPanelState() {
  const frame = document.querySelector(".app-frame");
  if (!frame) return;
  frame.classList.toggle("left-collapsed", state.leftCollapsed);
  frame.classList.toggle("right-collapsed", state.rightCollapsed);
  const right = document.querySelector("#toggleRight");
  right.innerHTML = panelToggleIcon("right", state.rightCollapsed);
  right.setAttribute("aria-label", state.rightCollapsed ? "Show details panel" : "Hide details panel");
  right.setAttribute("title", state.rightCollapsed ? "Show details panel" : "Hide details panel");
  document.querySelectorAll("[data-left-mode]").forEach((button) => {
    button.classList.toggle("active", !state.leftCollapsed && button.dataset.leftMode === state.leftMode);
  });
  requestAnimationFrame(() => {
    if (resize()) {
      fitGraph();
      draw();
    }
  });
  window.setTimeout(() => {
    if (resize()) {
      fitGraph();
      draw();
    }
  }, 220);
}

function panelToggleIcon(side, collapsed) {
  const points =
    side === "left"
      ? collapsed
        ? "8 6 12 10 8 14"
        : "12 6 8 10 12 14"
      : collapsed
        ? "12 6 8 10 12 14"
        : "8 6 12 10 8 14";
  const divider = side === "left" ? '<path d="M6.5 5.5v9" />' : '<path d="M13.5 5.5v9" />';
  return `
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
      ${divider}
      <path d="M${points}" />
    </svg>
  `;
}

async function saveConfig() {
  updateSelectedTermFromEditor();
  setSaveStatus("Saving JSON...");
  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: state.configPath, config })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    setSaveStatus(result.error || "Save failed.", true);
    return;
  }
  setSaveStatus(`Saved ${result.path}`);
}

function downloadStaticHtml() {
  if (!staticExportAssets) {
    throw new Error("Static export is still preparing. Try again in a moment.");
  }

  updateSelectedTermFromEditor();
  const html = createStaticHtml(config);
  return saveStaticHtml(html, `${slugify(config.title)}.html`);
}

async function saveStaticHtml(html, filename) {
  const response = await fetch("/api/save-static", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, filename })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.error || "Static export failed.");
  }
  setSaveStatus(`Saved static HTML to ${result.path}`);
  return result;
}

async function preloadStaticExportAssets() {
  if (STATIC_MODE) return;

  const sourceResponse = await fetch("/src/main.js");

  if (!sourceResponse.ok) {
    throw new Error("Static export requires the local Vite dev server so it can inline the current source files.");
  }

  const source = await sourceResponse.text();
  const exportStart = source.indexOf("function downloadStaticHtml() {");
  const runtimeMarker = "// Live/runtime interaction handlers.";
  const exportEnd = source.indexOf(`\n${runtimeMarker}`, exportStart);
  if (exportStart < 0 || exportEnd <= exportStart) {
    throw new Error("Static export could not isolate the runtime source.");
  }
  const sourceWithoutExport = `${source.slice(0, exportStart)}${source.slice(exportEnd)}`;
  const styles = Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join("\n")
    .replace(/<\/style/gi, "<\\/style");
  const appSource = sourceWithoutExport
    .replace(/^import\.meta\.env\s*=\s*\{[\s\S]*?\};import\s+["']\/src\/styles\.css["'];\s*/m, "")
    .replace(/^import\s+["']\.\/styles\.css["'];\s*/m, "")
    .replace(/^import\s+["']\/src\/styles\.css["'];\s*/m, "")
    .replaceAll("import.meta.env.VITE_APP_TITLE", JSON.stringify(APP_TITLE))
    .replaceAll("import.meta.env.VITE_HEADER_TITLE", JSON.stringify(HEADER_TITLE))
    .replaceAll("import.meta.env.VITE_HEADER_DESCRIPTION", JSON.stringify(HEADER_DESCRIPTION))
    .replaceAll("import.meta.env.VITE_DEFAULT_CONFIG", JSON.stringify(DEFAULT_CONFIG))
    .replace(/const downloadButton = document\.querySelector\("#downloadStatic"\);[\s\S]*?\n\s*document\.querySelector\("#toggleLabels"\)/, 'document.querySelector("#toggleLabels")');

  staticExportAssets = { appSource, styles };
  const downloadButton = document.querySelector("#downloadStatic");
  if (downloadButton) {
    downloadButton.disabled = false;
  }
}

function createStaticHtml(snapshot) {
  const { appSource, styles } = staticExportAssets;
  const scriptClose = "</" + "script>";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='18' cy='20' r='8' fill='%23b11f4b'/%3E%3Ccircle cx='46' cy='18' r='8' fill='%23b11f4b'/%3E%3Ccircle cx='34' cy='46' r='8' fill='%23b11f4b'/%3E%3Cpath d='M25 20h13M22 27l8 13M42 25l-6 14' stroke='%23242424' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E" />
<script>
  (() => {
    const param = new URLSearchParams(window.location.search).get("scoutTheme");
    const theme =
      param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  })();
${scriptClose}
<title>${escapeHtml(APP_TITLE)}</title>
<style>${styles}</style>
</head>
<body>
<main id="app"></main>
<script id="term-graph-data" type="application/json">${JSON.stringify(snapshot).replace(/</g, "\\u003c")}</script>
<script>${appSource.replace(/<\/script/gi, "<\\/script")}
${scriptClose}
</body>
</html>`;
}

// Live/runtime interaction handlers.
function selectTerm(id) {
  if (!termById.has(id)) return;
  state.activeId = id;
  renderDetails();
  renderLeftPane();
}

function nearestNode(x, y) {
  let nearest = null;
  let bestDistance = Infinity;
  for (const node of visibleNodes) {
    const p = project(node);
    const distance = Math.hypot(p.x - x, p.y - y);
    if (distance < bestDistance && distance < p.r + 18) {
      nearest = node;
      bestDistance = distance;
    }
  }
  return nearest;
}

function fitGraph() {
  state.offsetX = 0;
  state.offsetY = 0;
  state.scale = 1;

  const projected = visibleNodes.length ? visibleNodes.map(project) : nodes.map(project);
  const minX = Math.min(...projected.map((point) => point.x - point.r - 56));
  const maxX = Math.max(...projected.map((point) => point.x + point.r + 56));
  const minY = Math.min(...projected.map((point) => point.y - point.r - 40));
  const maxY = Math.max(...projected.map((point) => point.y + point.r + 40));
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const padding = 0.96;

  state.scale = Math.max(MIN_FIT_SCALE, Math.min((width / graphWidth) * padding, (height / graphHeight) * padding));
  state.fitScale = state.scale;

  const scaledCenterX = ((minX + maxX) / 2 - width / 2) * state.scale;
  const scaledCenterY = ((minY + maxY) / 2 - height / 2) * state.scale;
  state.offsetX = -scaledCenterX;
  state.offsetY = -scaledCenterY;
}

function refitGraph() {
  resize();
  fitGraph();
  draw();
}

function bindEvents() {
  canvas.addEventListener("pointerdown", (event) => {
    const node = nearestNode(event.offsetX, event.offsetY);
    pointer = {
      x: event.offsetX,
      y: event.offsetY,
      down: true,
      moved: false,
      node
    };
    state.autoRotate = false;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    state.hoverId = nearestNode(event.offsetX, event.offsetY)?.id || null;
    if (!pointer.down) return;

    const dx = event.offsetX - pointer.x;
    const dy = event.offsetY - pointer.y;
    pointer.moved = pointer.moved || Math.hypot(dx, dy) > 3;
    pointer.x = event.offsetX;
    pointer.y = event.offsetY;

    if (pointer.node) {
      pointer.node.x += dx / state.scale;
      pointer.node.y += dy / state.scale;
      pointer.node.vx = 0;
      pointer.node.vy = 0;
    } else {
      state.rotationY += dx * 0.006;
      state.rotationX = Math.max(-1.2, Math.min(1.2, state.rotationX + dy * 0.006));
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    const node = pointer.node;
    if (node && !pointer.moved) {
      selectTerm(node.id);
    }
    pointer.down = false;
    pointer.node = null;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.scale = Math.min(state.fitScale * 1.8, Math.max(state.fitScale * 0.72, state.scale * (event.deltaY > 0 ? 0.92 : 1.08)));
  });

  document.addEventListener("click", (event) => {
    const card = event.target.closest("[data-id]");
    if (card) selectTerm(card.dataset.id);
  });

  search.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.termPage = 0;
    filterGraph();
  });

  document.querySelector("#reset").addEventListener("click", () => {
    state.query = "";
    state.category = "all";
    state.termPage = 0;
    search.value = "";
    selectTerm(config.defaultTermId);
    filterGraph();
    refitGraph();
  });

  document.querySelector("#pause").addEventListener("click", (event) => {
    state.paused = !state.paused;
    state.autoRotate = !state.paused;
    updateCommandButtonStates();
  });

  document.querySelector("#fit").addEventListener("click", refitGraph);

  document.querySelector(".legend-scroll-left").addEventListener("click", () => {
    document.querySelector(".legend-strip").scrollBy({ left: -360, behavior: "smooth" });
  });

  document.querySelector(".legend-scroll-right").addEventListener("click", () => {
    document.querySelector(".legend-strip").scrollBy({ left: 360, behavior: "smooth" });
  });

  const downloadButton = document.querySelector("#downloadStatic");
  if (downloadButton) {
    downloadButton.disabled = !staticExportAssets;
    downloadButton.addEventListener("click", () => {
      try {
        downloadStaticHtml().catch((error) => {
          console.error(error);
          setSaveStatus(error.message, true);
        });
      } catch (error) {
        console.error(error);
        setSaveStatus(error.message, true);
      }
    });
  }

  document.querySelector("#toggleLabels").addEventListener("click", (event) => {
    state.showAllLabels = !state.showAllLabels;
    updateCommandButtonStates();
  });

  document.querySelector("#toggleRight").addEventListener("click", () => {
    state.rightCollapsed = !state.rightCollapsed;
    applyPanelState();
  });

  document.addEventListener("click", async (event) => {
    const categoryChip = event.target.closest("[data-category-filter]");
    if (categoryChip) {
      state.category = categoryChip.dataset.categoryFilter;
      state.termPage = 0;
      filterGraph();
      return;
    }

    const leftModeButton = event.target.closest("[data-left-mode]");
    if (leftModeButton) {
      const nextMode = leftModeButton.dataset.leftMode;
      if (state.leftMode === nextMode && !state.leftCollapsed) {
        state.leftCollapsed = true;
      } else {
        state.leftMode = nextMode;
        state.leftCollapsed = false;
      }
      renderLeftPane();
      applyPanelState();
      return;
    }

    if (event.target.id === "addTerm") {
      addTerm();
    } else if (event.target.id === "applyTerm") {
      updateSelectedTermFromEditor();
    } else if (event.target.id === "deleteTerm") {
      deleteSelectedTerm();
    } else if (event.target.id === "saveConfig") {
      try {
        await saveConfig();
      } catch (error) {
        setSaveStatus(error.message, true);
      }
    } else if (event.target.id === "addSource") {
      addSourceFromEditor();
    } else if (event.target.id === "prevTerms") {
      state.termPage = Math.max(0, state.termPage - 1);
      renderLeftPane();
    } else if (event.target.id === "nextTerms") {
      state.termPage = Math.min(Math.max(0, Math.ceil(visibleNodes.length / TERMS_PAGE_SIZE) - 1), state.termPage + 1);
      renderLeftPane();
    }
  });

  document.querySelector("#theme").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    updateThemeButton();
  });
}

function updateThemeButton() {
  const button = document.querySelector("#theme");
  if (!button) return;
  const current = document.documentElement.getAttribute("data-theme");
  button.textContent = current === "dark" ? "☀" : "☾";
  button.setAttribute("aria-label", current === "dark" ? "Switch to light theme" : "Switch to dark theme");
  button.setAttribute("title", current === "dark" ? "Switch to light theme" : "Switch to dark theme");
}

function updateCommandButtonStates() {
  const pause = document.querySelector("#pause");
  if (pause) {
    pause.innerHTML = commandIcon(state.paused ? "play" : "pause");
    pause.classList.toggle("active", state.paused);
    pause.setAttribute("aria-label", state.paused ? "Resume motion" : "Pause motion");
    pause.setAttribute("title", state.paused ? "Resume motion" : "Pause motion");
  }

  const labels = document.querySelector("#toggleLabels");
  if (labels) {
    labels.classList.toggle("active", state.showAllLabels);
    labels.setAttribute("aria-label", state.showAllLabels ? "Focus labels" : "Show all labels");
    labels.setAttribute("title", state.showAllLabels ? "Focus labels" : "Show all labels");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
    }
  });
}

function animate() {
  tick();
  draw();
  requestAnimationFrame(animate);
}

function renderError(error) {
  document.querySelector("#app").innerHTML = `
    <div class="shell">
      <section class="sidebar">
        <p class="eyebrow">Configuration error</p>
        <h1>Could not load dictionary</h1>
        <p class="muted">${escapeHtml(error.message)}</p>
      </section>
    </div>
  `;
}

async function bootstrap() {
  try {
    initializeGraph(await loadConfig());
    renderShell();
    updateThemeButton();
    updateCommandButtonStates();
    if (!STATIC_MODE && typeof preloadStaticExportAssets === "function") {
      preloadStaticExportAssets().catch((error) => {
        console.error(error);
        const downloadButton = document.querySelector("#downloadStatic");
        if (downloadButton) {
          downloadButton.title = error.message;
        }
      });
    }
    resize();
    fitGraph();
    filterGraph();
    renderDetails();
    window.addEventListener("resize", () => {
      if (resize()) {
        fitGraph();
        draw();
      }
    });
    requestAnimationFrame(animate);
  } catch (error) {
    renderError(error);
  }
}

bootstrap();
