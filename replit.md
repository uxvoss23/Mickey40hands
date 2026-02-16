# Galactic Navigation System - Alien Customer CRM

## Overview
The Galactic Navigation System is a single-page web application designed for customer relationship management (CRM) with a strong emphasis on map-based visualization. It serves as a comprehensive tool for managing customer data, scheduling jobs, planning routes, and tracking field technicians. The system aims to streamline operations for businesses requiring spatial customer management, offering features like advanced filtering, data import/export, and real-time technician tracking. Its primary purpose is to provide an intuitive platform for businesses to manage their customer base and field operations efficiently.

## User Preferences
I want iterative development.
Ask before making major changes.
I prefer detailed explanations.
Do not make changes to the folder `server/db`.
Do not make changes to the file `server/db/pool.js`.
Do not make changes to the file `server/db/migrate.js`.

## System Architecture
The application is a full-stack web application comprising an Express.js backend and a React single-page application (SPA) frontend.

### Frontend
- **Technology**: React 18 (loaded via CDN), Leaflet.js for interactive maps, and Babel for in-browser JSX transpilation.
- **UI/UX**: Features map visualization with customer markers, clustering, and heat maps. The interface includes a dashboard as the default landing view, customizable customer type tabs, and a compact filter panel accessible via a settings icon. Design decisions include dark-themed elements for improved readability (e.g., Google Places dropdown) and a streamlined workflow for route planning and customer management.
- **Key Features**:
    - **Map Visualization**: Displays customer locations, route lines, and real-time technician positions.
    - **Customer Database View**: Hyper-customizable pipeline view with global search, quick filters, multi-column sorting, and inline cell editing. Supports column visibility controls and saved views.
    - **Customer Management**: Quick Add Customer form with geocoding, customer profiles with service history, job creation with pricing tiers, and bulk customer import via CSV.
    - **Job Management**: Job creation, editing, and deletion; supports recurring jobs with auto-scheduling based on recurrence intervals.
    - **Route Planning**: Drag-and-drop route optimization, multi-day route selection with color-coded lines, and a sidebar for route stats and unrouted jobs. Includes an unsaved route warning system.
    - **Data Export**: CSV and JSON export functionalities for customer data.
    - **Public Intake Form**: A standalone page `/intake` for public customer submissions, integrating Google Places Autocomplete.
    - **Technician Tracking**: A mobile-friendly `/track` page for real-time GPS location sharing, displaying technician markers on the main map.
    - **Gap Fill System**: Mid-day cancellation handling with 5-tier candidate ranking, pre-written messages, progressive search expansion, and integrated cancel/reactivate flow in Route Planner sidebar.

### Backend
- **Technology**: Express.js for the REST API server.
- **Database**: PostgreSQL, with Neon-backed hosting via Replit.
- **Schema**:
    - `customers`: Core customer data including `customer_type`, `status`, `city`, `state`, `zip`, `panels`, `last_service_date`, `anytime_access`, `flexible`, `preferred_contact_method`, `cancellation_count`.
    - `jobs`: Job records linked to customers, storing details like `job_description`, `status`, `notes`, `price`, `price_per_panel`, `preferred_days`, `preferred_time`, `technician`, `cancellation_reason`, `cancellation_note`, `cancelled_at`, `gap_fill_attempted`, `gap_fill_session_id`, `is_gap_fill`.
    - `routes`: Saved route configurations.
    - `route_stops`: Individual stops within routes.
    - `saved_lists`: User-defined customer list configurations.
    - `gap_fill_sessions`: Tracks active gap fill sessions with cancelled stop info, time window, and resolution status.
    - `gap_fill_candidates`: Ranked replacement candidates per session with tier, distance, score, and outreach status.
    - `gap_fill_outreach_log`: Contact attempt history with timestamps and methods for frequency limiting.
- **API Endpoints**: Comprehensive RESTful API for CRUD operations on customers, jobs, routes, and lists. Includes specialized endpoints for customer statistics, bulk import, data export, and gap-fill session management.
    - **Gap Fill API** (`/api/gapfill/`): Session creation, candidate ranking with 5-tier system, progressive 4-layer expansion (8mi→15mi→20mi→30mi), outreach logging, confirmation, and session closure.
    - **Route Cancellation** (`/api/routes/:id/stops/:stopId/cancel`): Cancel route stops with reason tracking, auto-create duplicate unscheduled job, increment cancellation count.
    - **Route Reactivation** (`/api/routes/:id/stops/:stopId/reactivate`): Reverse cancellation and restore job status.
- **Data Flow**: PostgreSQL acts as the single source of truth. Frontend loads data from the API on startup. Customer and job updates propagate to the database via non-blocking PATCH requests. CSV import includes deduplication logic based on address and merges job history.
- **Deployment**: The application is designed for `autoscale` deployment, with `node server/index.js` as the run command. Database migrations are automatically run on server startup.

### Gap Fill System Architecture
- **5-Tier Prioritization**: Anytime Access → Recurring Due/Overdue → Flexible Unscheduled → Pull Forward Scheduled → Past Non-Recurring
- **Time Feasibility**: 75-min standard job duration, 6 PM CST hard cutoff, travel time estimation via straight-line distance
- **Directional Bias**: Candidates scored toward next stop for routing efficiency
- **Contact Frequency Limits**: Max 1 outreach per week, 3 per month per customer
- **Progressive Expansion**: 4 search layers (8mi → 15mi → 20mi → 30mi)
- **6-Month Cooldown**: After completed gap-fill job, customer excluded for 6 months
- **Manual-First Approach**: Pre-written personalized messages for copy/paste workflow (Phase 1)
- **Route Locking**: Route locked during active gap-fill session to prevent conflicts

## Recent Changes
- **2026-02-16**: Added cancel/reactivate buttons to Route History view. Cancelled stops now persist in database (route_stops.cancelled column), sync across Route Planner and Route History views. Reactivate fully restores job to scheduled state, decrements cancellation count, and removes duplicate unscheduled jobs. Fixed gap-fill time gate to use CST timezone. Fixed route ID format issues (db-N vs numeric) for cancel/reactivate API calls.
- **2026-02-16**: Built complete gap-fill system including database schema, backend API, admin cancellation flow, tech-side cancellation, gap-fill panel UI, customer profile gap-fill settings, and success rate tracking.

## External Dependencies
- **Backend (npm)**:
    - `express`: Web server framework.
    - `pg`: PostgreSQL client.
    - `cors`: Middleware for enabling Cross-Origin Resource Sharing.
- **Frontend (CDN)**:
    - `React 18` & `ReactDOM`: JavaScript library for building user interfaces.
    - `Leaflet 1.9.4`: Open-source JavaScript library for interactive maps.
    - `Leaflet.markercluster 1.5.3`: Plugin for clustering markers on Leaflet maps.
    - `Leaflet.heat 0.2.0`: Plugin for heatmap visualization on Leaflet maps.
    - `Babel Standalone`: In-browser JSX transpilation.
    - `Inter font`: From Google Fonts for typography.
    - `resend`: Email sending service for formatted HTML route emails.
- **APIs/Services**:
    - `Google Places Autocomplete API`: For address autocompletion and geocoding.
    - `Nominatim API`: Used for initial geocoding (though largely replaced by Google Places for autocomplete, it may still serve for reverse geocoding or specific needs).
    - `Resend API`: For sending formatted HTML emails (route details to technicians). Free tier limited to sending to the account owner email only (solarcleaning@suntonsolutions.com). To send to other addresses, verify a domain at resend.com/domains. API key stored as RESEND_API_KEY secret.
