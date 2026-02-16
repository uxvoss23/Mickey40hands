# CLAUDE.md - Mickey40hands (Galactic Navigation System / Alien Customer CRM)

## Project Overview

A single-page React application for solar panel cleaning route planning, customer relationship management, and Google Sheets integration. Built as a monolithic HTML file with no build tooling — all dependencies loaded via CDN and JSX transpiled at runtime by Babel.

**Primary use case:** DFW-area solar panel cleaning business — managing customer lists, planning efficient service routes, tracking jobs, and syncing data with Google Sheets.

## Architecture

### Single-File Application

The entire app lives in `index.html` (~12,300 lines). There is no build system, no bundler, no package manager.

- **Framework:** React 18 (UMD via unpkg CDN)
- **JSX:** Babel standalone transpilation at runtime (`<script type="text/babel">`)
- **Mapping:** Leaflet 1.9.4 + MarkerCluster + Leaflet Heat
- **Fonts:** Google Fonts (Inter)
- **Styling:** Inline `<style>` block (CSS, no preprocessor)

### Component Structure

One monolithic functional component: `CustomerMap` (line ~422). Uses extensive React hooks:
- ~124 `useState` hooks for all UI and data state
- ~39 `useEffect` hooks for side effects and syncing
- ~17 `useRef` hooks for DOM references (map, markers, polygons)

No component composition — everything is inside `CustomerMap`.

### State & Persistence

All persistent data stored in `localStorage`:

| Key | Purpose |
|-----|---------|
| `savedRoutes` | Route definitions with customer stops |
| `googleSheetId` | Connected Google Sheets ID |
| `googleApiKey` | Google API key |
| `appsScriptUrl` | Apps Script endpoint for sheet write-back |
| `localOverrides` | Local data override tracking |
| `unsyncedChanges` | Pending changes awaiting sync |
| `lastSyncCompleted` | Timestamp of last successful sync |
| `lastSheetExport` | Timestamp of last export |
| `propertyApiKey` | ATTOM API key for property verification |
| `gapFillerVerifications` | Property verification cache |

### External APIs

- **Google Sheets** — CSV-based import/export, bi-directional sync
- **Apps Script** — Write-back endpoint for sheet updates
- **Nominatim (OpenStreetMap)** — Geocoding addresses to coordinates
- **ATTOM API** — Property data and solar permit verification
- **allorigins.win** — CORS proxy for cross-origin requests

### Key Constants

- `HOME_BASE_ADDRESS` — `"1444 Mountain Air Trail, Fort Worth, TX 76131"` (line 420)
- `PRODUCTION_MODE` — Set to `true` to suppress console logs (line 424)

## Development Workflow

### Running the App

Open `index.html` in a browser. No server, build step, or install required.

### Debugging

Set `PRODUCTION_MODE = false` (line 424) to enable `console.log` output throughout the app.

### Making Changes

1. Edit `index.html` directly
2. Refresh browser to see changes (Babel re-transpiles on load)
3. All state persists in localStorage between reloads

### Git Conventions

- **Branch naming:** `claude/claude-md-*` or `claude/alien-crm-system-*` for feature branches
- **Commit style:** Imperative mood, descriptive messages (e.g., "Fix sidebar hidden when no customers", "Add scheduled map view with week/month routes")
- **PR workflow:** Feature branches merged to `main` via pull requests

## Key Features

- **Interactive map** with marker clustering, heatmaps, and polygon drawing
- **Route planning** with drag-and-drop scheduling and day/week/month calendar views
- **Google Sheets two-way sync** with local override protection and auto-sync (30s intervals)
- **Customer verification** via ATTOM API (property type, solar permits)
- **CSV import/export** with column mapping validation
- **Radius search** and polygon area selection
- **Job scheduling** with recurring job management
- **Customer profiles** with editable fields and job history
- **Pricing tier calculations** and distance calculations

## Code Conventions

- All code is plain JavaScript (ES6+) inside a Babel `text/babel` script block
- CSS uses dark theme with purple accent (`#8b5cf6` / `rgba(139, 92, 246, ...)`)
- Safe `.trim()` guards throughout — always check for `undefined` before calling `.trim()`
- CSV parsing handles missing/undefined column values defensively
- Customer data stored as JSON objects with geocoded lat/lng
- Merge logic handles duplicate customers during imports (merge jobs, don't skip)

## Common Pitfalls

- **`.trim()` on undefined:** Multiple past bugs from calling `.trim()` on undefined column values. Always guard with `(value || '').trim()` or optional chaining.
- **Sheet cache causing reverts:** CSV data is cached; edits can revert if cache isn't invalidated. The `lastSheetExport` timestamp prevents stale reads.
- **Local overrides vs sync:** The `localOverrides` and `unsyncedChanges` system prevents auto-refresh from overwriting manual edits. Respect this pattern.
- **Large marker sets:** With 20k+ markers, always use marker clustering and the `showAllMarkers` toggle to avoid performance issues.

## File Structure

```
Mickey40hands/
├── index.html      # Entire application (12,300+ lines)
├── CLAUDE.md       # This file
└── .gitkeep        # Placeholder
```

## No Build Tools / No Tests

There is no:
- Package manager (npm/yarn/pnpm)
- Build system (webpack/vite/rollup)
- Test framework (Jest/Vitest)
- Linter (ESLint)
- Formatter (Prettier)
- CI/CD pipeline

All quality assurance is manual. Changes are validated by opening the browser and testing functionality.
