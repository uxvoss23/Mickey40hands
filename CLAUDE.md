# CLAUDE.md — AI Assistant Guide for Mickey40hands

## Project Overview

**Mickey40hands** is a full-stack CRM and field-operations management application for **Sunton Solutions**, a solar panel cleaning company. It provides:

- Map-based customer visualization with clustering and heatmaps
- Customer pipeline management with filtering and sorting
- Job scheduling with recurring service plan support
- Route planning with drag-and-drop optimization
- A **Gap-Fill System** to handle same-day cancellations
- Real-time technician location tracking
- Public intake form, enrollment portal, and mobile technician views
- CSV/JSON data export and email route delivery

The app is deployed on **Replit** (autoscale) and uses a **Neon-backed PostgreSQL** database.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Backend framework | Express.js 5.x |
| Database | PostgreSQL 16 (via `pg` library) |
| Email service | Resend API |
| Frontend | React 18 (CDN), Babel Standalone (in-browser JSX) |
| Maps | Leaflet 1.9.4, markercluster, leaflet.heat |
| Geocoding | Google Places API, Nominatim (fallback) |
| Testing | Node.js built-in `node:test` module |

---

## Repository Structure

```
Mickey40hands/
├── index.html          # Main SPA (~16 K lines) — all frontend code
├── intake.html         # Public customer intake form
├── track.html          # Technician GPS location sharing UI
├── tech-route.html     # Mobile technician route completion view
├── package.json        # npm scripts and dependencies
├── replit.md           # Project documentation and user preferences
├── .replit             # Replit platform configuration
└── server/
    ├── index.js        # Express app entry point (~18 K lines)
    ├── db/
    │   ├── pool.js     # PostgreSQL connection pool  ← DO NOT MODIFY
    │   └── migrate.js  # Schema initialization       ← DO NOT MODIFY
    └── routes/
        ├── customers.js    # Customer CRUD and search
        ├── jobs.js         # Job management + recurring generation
        ├── routes.js       # Route planning and management
        ├── gapfill.js      # Gap-fill algorithm (5-tier system)
        ├── email.js        # Email route delivery via Resend
        ├── export.js       # CSV/JSON export
        └── lists.js        # Saved customer lists
    └── tests/
        ├── gapfill.test.js         # Primary test suite (extensive)
        ├── api.test.js
        ├── integration.test.js
        ├── data-integrity.test.js
        ├── security.test.js
        ├── race-condition.test.js
        └── load.test.js
```

---

## Critical Rules

1. **NEVER modify `server/db/pool.js` or `server/db/migrate.js`.** These files manage the database connection and schema initialization. Altering them can break the entire app's database access in production.

2. **Ask before making major changes.** The development style is iterative and collaborative. Confirm architectural decisions with the user before implementing them.

3. **All frontend lives in HTML files.** There is no build step or bundler. React JSX is transpiled in the browser by Babel Standalone. Keep frontend changes inside the relevant `.html` file.

4. **Use parameterized queries for all SQL.** The `pg` library is used throughout; never interpolate user input directly into query strings.

5. **Environment variables are required at runtime:**
   - `DATABASE_URL` — PostgreSQL connection string
   - `GOOGLE_MAPS_API_KEY` — Google Places Autocomplete
   - `RESEND_API_KEY` — Resend email service

---

## Development Workflow

### Running the Application

```bash
node server/index.js
# Listens on port 5000 (Replit maps this to port 80 externally)
```

The database schema is applied automatically on startup via `migrate()`.

### Running Tests

```bash
npm test                  # Gap-fill unit tests (primary suite)
npm run test:unit         # Unit tests
npm run test:integration  # Integration tests
npm run test:api          # API endpoint tests
npm run test:security     # Security and input validation
npm run test:race         # Race condition tests
npm run test:data         # Data integrity tests
npm run test:load         # Load/performance tests
npm run test:all          # All suites
```

**Testing framework:** Node.js built-in `node:test` — no Jest or Mocha. Tests use module-level pool mocking.

### No CI/CD Pipeline

There are no GitHub Actions or CI configuration files. All deployment is handled through Replit's platform directly.

---

## Database Schema

### Core Tables

| Table | Purpose |
|---|---|
| `customers` | Customer records (50+ fields) |
| `jobs` | Service jobs linked to customers |
| `routes` | Saved route configurations |
| `route_stops` | Individual stops within a route |
| `saved_lists` | User-defined customer lists |
| `saved_list_items` | Items within a saved list |

### Gap-Fill Tables

| Table | Purpose |
|---|---|
| `gap_fill_sessions` | Active gap-fill sessions (cancelled stop details) |
| `gap_fill_candidates` | Ranked replacement candidates |
| `gap_fill_outreach_log` | Contact attempt history for rate limiting |

### Key Customer Fields

- `anytime_access` — Customer is always available (highest gap-fill priority)
- `flexible` — Customer has schedule flexibility
- `is_recurring` — Has a recurring maintenance plan
- `cancellation_count` — Number of times customer has cancelled
- `last_service_date` / `next_service_date` — Service cadence tracking
- `gap_fill_session_id` — Foreign key to active gap-fill session

**Indexes** exist on `status`, `city`, `state`, `lat`/`lng`, `is_recurring`, and other commonly filtered fields.

---

## API Route Reference

| Method | Path | Description |
|---|---|---|
| `GET/POST/PATCH/DELETE` | `/api/customers` | Customer CRUD |
| `GET/POST/PATCH/DELETE` | `/api/jobs` | Job management |
| `GET/POST/PATCH/DELETE` | `/api/routes` | Route management |
| `GET/POST/DELETE` | `/api/lists` | Saved lists |
| `GET` | `/api/export` | CSV/JSON export |
| `POST` | `/api/email` | Send route email via Resend |
| `GET/POST/PATCH` | `/api/gapfill` | Gap-fill sessions and candidates |
| `GET` | `/api/config/maps-key` | Google Maps API key |
| `GET` | `/api/geocode` | Nominatim geocoding proxy |
| `POST` | `/api/technician/location` | Real-time technician GPS |
| `GET` | `/intake` | Public intake form page |
| `GET` | `/track` | Technician tracker page |
| `GET` | `/tech-route/:id` | Mobile tech route view |
| `GET` | `/enroll/:token` | Recurring plan enrollment portal |

---

## Gap-Fill System

The Gap-Fill System replaces same-day cancelled route stops with nearby available customers.

### 5-Tier Prioritization

| Tier | Criteria | Priority |
|---|---|---|
| 1 | `anytime_access = true` | Highest |
| 2 | Recurring customer due or overdue | High |
| 3 | Flexible customer, unscheduled | Medium |
| 4 | Scheduled customer (pull forward) | Low |
| 5 | Past non-recurring customer | Lowest |

### Scoring Algorithm

Candidates are scored by:
- **Distance** (haversine formula, radius-based)
- **Directional bias** (dot product toward next stop)
- **Time feasibility** (75-min job duration, 6 PM CST hard cutoff)
- **Contact frequency limits** (max 1/week, 3/month per customer)

### Progressive Radius Expansion

Search expands in 4 layers: **8 mi → 15 mi → 20 mi → 30 mi**

### Key Constants (`server/routes/gapfill.js`)

```javascript
JOB_DURATION_MINUTES = 75
HARD_CUTOFF_HOUR    = 18        // 6 PM CST
MAX_CONTACTS_PER_WEEK  = 1
MAX_CONTACTS_PER_MONTH = 3
COOLDOWN_MONTHS        = 6      // after a completed gap-fill job
AVG_SPEED_MPH          = 25
TIMEZONE               = 'America/Chicago'
```

### Session Lifecycle

1. Technician cancels a route stop → gap-fill session created, route locked
2. Candidates ranked and surfaced to dispatcher
3. Dispatcher contacts customer (pre-written personalized messages)
4. If accepted: new job created, session closed, route unlocked
5. Outreach attempts logged to enforce frequency limits

---

## Job Scheduling Conventions

- **Recurring intervals:** `annual` (12 mo), `biannual` (6 mo), `triannual` (4 mo)
- Recurring job generation creates **10 years** of future jobs
- Jobs scheduled within **30 days** are automatically set to `status = 'scheduled'`
- Job completion triggers customer status update and `next_service_date` recalculation

---

## Frontend Architecture

- All UI lives in **one HTML file per view** (`index.html`, `intake.html`, etc.)
- React 18 components are written inline as JSX and transpiled at runtime by Babel Standalone
- **No npm build step** — there is no webpack, Vite, or similar tool
- Dark theme design with glassmorphism and purple/indigo gradient accents
- Leaflet.js is used for the map; markers, clustering, and heatmap layers are all managed client-side
- Modal-based workflows for gap-fill, route cancellation, and customer enrollment

---

## Security Considerations

- All SQL uses parameterized queries via the `pg` library
- Email endpoint has rate limiting: **5 requests/minute/IP**
- API keys are stored as environment variables, never hardcoded
- Input validation is performed in each route handler
- `X-Frame-Options` header is not set (allows embedding in Replit preview)

---

## Technician Location Tracking

- Technician GPS positions are stored **in memory** (`technicianLocations` object in `server/index.js`)
- Locations expire after **60 seconds** of inactivity
- The `/track` page is for technicians to share their location
- The `/tech-route/:id` page is for technicians to view and complete their assigned route

---

## Deployment

- **Platform:** Replit (autoscale)
- **Start command:** `node server/index.js`
- **Internal port:** 5000 → mapped to port 80 externally
- **Database:** Neon-backed PostgreSQL provisioned by Replit
- **Schema migrations:** Applied automatically on every startup

---

## Development Style Preferences

- Iterative, incremental changes
- Ask the user before implementing major architectural changes
- Prefer detailed explanations of what a change does and why
- Do not add speculative features or complexity beyond what is requested
- Keep code readable; avoid over-engineering
