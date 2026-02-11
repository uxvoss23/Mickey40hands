# Galactic Navigation System - Alien Customer CRM

## Overview
A single-page web application for customer relationship management with map-based visualization. Uses React (via CDN), Leaflet maps, and Babel for in-browser JSX transpilation, backed by a PostgreSQL database and Express.js API server.

## Project Architecture
- **Type**: Full-stack web application (Express.js + React SPA)
- **Frontend**: React 18 (CDN), Leaflet.js for maps, Babel for JSX
- **Backend**: Express.js REST API server
- **Database**: PostgreSQL (Neon-backed via Replit)
- **File Structure**:
  - `index.html` - Single-file React SPA (~12,500 lines) with all HTML, CSS, and JavaScript
  - `server/index.js` - Express server entry point (serves API + static files)
  - `server/db/pool.js` - PostgreSQL connection pool
  - `server/db/migrate.js` - Database schema migrations (auto-run on startup)
  - `server/routes/customers.js` - Customer CRUD API with advanced filtering/sorting
  - `server/routes/jobs.js` - Jobs API
  - `server/routes/routes.js` - Routes & route stops API
  - `server/routes/lists.js` - Saved lists API
  - `server/routes/export.js` - CSV/JSON export endpoints

## Database Schema
- **customers** - Core customer data with indexed fields (status, city, state, zip, panels, last_service_date)
- **jobs** - Job records linked to customers
- **routes** - Saved routes for route planning
- **route_stops** - Individual stops within routes
- **saved_lists** - Saved customer list configurations

## API Endpoints
- `GET /api/customers` - List with filters (status, city, state, zip, search, sort, limit, offset)
- `GET /api/customers/stats` - Dashboard statistics
- `POST /api/customers` - Create customer
- `POST /api/customers/bulk` - Bulk import customers
- `PATCH /api/customers/:id` - Update customer fields
- `DELETE /api/customers/:id` - Delete customer
- `GET /api/export/csv` - Export all customers as CSV
- `GET /api/export/json` - Export all customers as JSON
- Jobs, routes, lists endpoints follow similar patterns

## Data Flow
1. **Database as Primary**: PostgreSQL is the single source of truth for all customer data
2. **Database Auto-load**: On startup, frontend loads customers from `/api/customers` into savedLists
3. **CSV Import**: Manual CSV file upload → deduplicates by address → bulk saves to database with job history
4. **Customer Updates**: Changes propagate to database via PATCH requests (non-blocking)
5. **Export**: CSV/JSON export available from database via API endpoints

## How to Run
- `node server/index.js` starts the Express server on port 5000
- Server auto-runs database migrations on startup
- The workflow "Start application" handles this automatically

## Key Features
- Map visualization with customer markers, clustering, and heat maps
- Route planning with drag-and-drop optimization
- Calendar/scheduling view
- Pipeline view with hyper-customizable filtering:
  - Global search across all columns
  - Quick filter presets (Unscheduled, Scheduled, Completed, Recurring, Has Email, Has Phone)
  - Per-column text filters
  - Multi-column sorting
- CSV file upload with automatic deduplication and job history merging
- CSV/JSON export from database
- Customer profiles with service history
- Job creation with pricing tiers

## Key Dependencies
### Backend (npm)
- express - Web server
- pg - PostgreSQL client
- cors - Cross-origin support

### Frontend (CDN)
- React 18 & ReactDOM
- Leaflet 1.9.4 (maps)
- Leaflet.markercluster 1.5.3
- Leaflet.heat 0.2.0
- Babel Standalone (in-browser JSX transpilation)
- Inter font (Google Fonts)

## Deployment
- Deployment target: autoscale
- Run command: `node server/index.js`
- Database: PostgreSQL (auto-migrates on startup)

## Recent Changes
- 2026-02-11: Added CSV file upload directly to database from Database view
- 2026-02-11: Added "New Customer" creation form in Database view
- 2026-02-11: Fixed Google Sheets import to properly save contacts to PostgreSQL database (field name mapping fix)
- 2026-02-11: Detached from Google Sheets as live data source; pipeline now shows clean database customer table
- 2026-02-11: Removed auto-refresh/live sync (was only needed for Google Sheets as database)
- 2026-02-11: Rebuilt pipeline as "Customer Database" view with 16 named columns, status badges, click-to-profile
- 2026-02-11: Migrated from static file serving to Express.js backend with PostgreSQL database
- 2026-02-11: Added comprehensive REST API for customers, jobs, routes, lists
- 2026-02-11: Upgraded pipeline view with global search, quick filters, per-column filters, and CSV export
- 2026-02-11: Frontend auto-loads from database on startup, syncs updates via PATCH
- 2026-02-11: Fixed status filtering bug (case-sensitivity normalization)
- 2026-02-11: CSV/Google Sheets import now deduplicates by address and merges job history
- 2026-02-11: Bulk save to database includes deduplicated customers with full service history as job records
- 2026-02-11: Customer profile shows most recent job date/status and sorted Job History with status badges
- 2026-02-11: Added dedup guards to prevent duplicate job entries with same date and description
- 2026-02-11: Removed Google Sheets connection panel, auto-sync, write-back, and all related code (~80KB removed)
