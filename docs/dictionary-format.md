# Dictionary format

The visualizer is generic. Project-specific terminology lives in JSON files under `public/configs`.

Use `.env` to choose the local default dictionary:

```env
VITE_APP_TITLE=Term Graph Visualizer
VITE_DEFAULT_CONFIG=/configs/example-dictionary.json
```

Keep private or project-specific dictionaries out of git. This repo ignores files such as `public/configs/local-*.json`; use `.env` locally to point at those files.

## Shape

Each dictionary has:

| Field | Purpose |
| --- | --- |
| `categories` | Legend groups and node colors. |
| `sources` | Optional reference documents, meetings, or notes used to define terms. |
| `terms` | Nodes in the graph. |
| `terms[].related` | Lightweight untyped links used for browsing. |
| `terms[].sourceIds` | Source IDs that support a term's definition. |
| `edges` | Optional typed relationships such as `owns`, `uses`, `precedes`, or `measured-by`. |

IDs should be lowercase slugs, for example `product-launch`.

## Minimal term

```json
{
  "id": "product-launch",
  "title": "Product Launch",
  "category": "process",
  "summary": "Coordinated release of a product or feature.",
  "details": "Connects planning, readiness, messaging, measurement, and follow-up.",
  "aliases": ["Launch"],
  "related": ["launch-plan"],
  "sourceIds": ["launch-workshop"]
}
```

## Source

```json
{
  "id": "launch-workshop",
  "title": "Launch planning workshop",
  "type": "Workshop notes",
  "url": "",
  "notes": "Internal reference"
}
```

## Typed edge

```json
{
  "source": "product-launch",
  "label": "uses",
  "target": "launch-plan"
}
```

The UI supports editing terms locally when running `npm run dev`. Click **Save JSON** to persist changes through the local Vite dev API. Click **Download static HTML** to create a view-only snapshot for sharing.

## Adding references in the UI

In edit mode, the **References** section shows all sources in the current dictionary as selectable cards. Use **Add a new reference** to create a source with title, type, optional URL, and optional notes. The new source is added to the dictionary's top-level `sources` array and automatically selected for the current term via `sourceIds`. Click **Save JSON** to persist it.
