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
- 2026-02-12: Added automatic geocoding via Nominatim API - server endpoint at /api/customers/geocode
- 2026-02-12: Rebuilt Quick Add Customer form with auto-geocode: type address, click out, coordinates auto-found
- 2026-02-12: Auto-fills city/state/zip from geocode results; green "Location Found" badge confirms success
- 2026-02-12: Save & Show on Map button pans map to new customer after creation
- 2026-02-12: Debounced geocode calls to prevent rate-limiting from Nominatim
- 2026-02-12: Rebuilt Quick Add Customer form: replaced Status dropdown with "Add Job?" toggle button
- 2026-02-12: Two-step customer creation: save customer first, then optional Add Job popup with 7 service types
- 2026-02-12: Service types: Residential/Commercial Panel Cleaning, Critter Guard Install/Repair, General Repair, Pressure Washing, Site Visit
- 2026-02-12: Jobs save to database via POST /api/jobs with customer_id, job_description, status, notes
- 2026-02-12: Click-to-edit jobs from customer profile: Edit button on job history cards opens pre-filled form
- 2026-02-12: Edit mode preserves existing job status; only new jobs set status to 'unscheduled'
- 2026-02-12: Job history cards show preferred days, time, technician, and recurring badges
- 2026-02-12: After new job creation, auto-navigates to map view zoomed to customer location
- 2026-02-12: Redesigned Add Job form with customer contact info auto-populated at top
- 2026-02-12: Service-specific inputs: Residential Cleaning shows panels, price per panel ($9/$8/$7/$6), auto-calculated total price
- 2026-02-12: Total price auto-calculates (panels x price per panel) with manual override option and "Reset to auto" link
- 2026-02-12: Preferred days multi-select (Mon-Sat), preferred time (AM/PM), and technician assignment (Chance T)
- 2026-02-12: Jobs table extended with price, price_per_panel, preferred_days, preferred_time, technician columns
- 2026-02-12: Centralized openJobPopupForCustomer() helper passes full customer data (phone, email, address)
- 2026-02-12: Customer status defaults to blank (no job) or "unscheduled" (job added)
- 2026-02-12: Integrated Google Places Autocomplete for address fields (replaces Nominatim for autocomplete)
- 2026-02-12: Google Maps SDK loaded dynamically via /api/config/maps-key endpoint (secure key delivery)
- 2026-02-12: Google Places auto-fills street, city, state, zip, and precise lat/lng coordinates
- 2026-02-12: Dark-themed Google Places dropdown via .pac-container CSS overrides
- 2026-02-12: Built shareable public intake form at /intake — standalone page, no login required
- 2026-02-12: Intake form has Google Places autocomplete, name/phone/email/address fields, optional job request
- 2026-02-12: Intake form submissions save to database with source='intake-form' tag
- 2026-02-12: intake.html served via dedicated route, separate from main SPA
- 2026-02-13: Added customer_type column to database (residential, commercial, partner, hoa) with index
- 2026-02-13: Customer type tabs at top of UI: All, Residential, Commercial, Partners, HOAs, + custom tabs
- 2026-02-13: Custom customer type tabs stored in localStorage, users can add unlimited custom types
- 2026-02-13: Customer type filtering integrated into unified filter (works with all other filters)
- 2026-02-13: Customer type selector in profile modal for changing customer type
- 2026-02-13: Converted Database view quick filter buttons to dropdown menu for cleaner UI
- 2026-02-13: Added Dashboard as default landing view with stats cards, weekly calendar strip, today's jobs, needs attention, and recently added sections
- 2026-02-13: Dashboard is the first tab users see on load — clean overview before diving into map/database
- 2026-02-13: Replaced spread-out filter toolbar in Database view with compact settings icon that opens filter panel
- 2026-02-13: Top search bar hidden on Dashboard and Database views (both have their own search)
- 2026-02-11: Added column visibility controls: hide columns via X button on headers, restore via Column Manager panel
- 2026-02-11: Column visibility saved to localStorage - persists across sessions as 'saved view'
- 2026-02-11: Removed per-column filter inputs from database table header
- 2026-02-11: Added inline cell editing: click any cell to edit, checkmark to confirm, saves via propagateCustomerUpdate to DB
- 2026-02-11: Quick filter (Scheduled/Completed/etc) temporarily unhides matching hidden columns for that session only
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
