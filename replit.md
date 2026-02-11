# Galactic Navigation System - Alien Customer CRM

## Overview
A single-page web application for customer relationship management with map-based visualization. Built as a static site using React (via CDN), Leaflet maps, and Babel for in-browser JSX transpilation.

## Project Architecture
- **Type**: Static single-page application
- **Frontend**: React 18 (CDN), Leaflet.js for maps, Babel for JSX
- **File Structure**: Single `index.html` file (~12,000 lines) containing all HTML, CSS, and JavaScript
- **Build System**: None (static file serving)
- **Backend**: None
- **Database**: None (uses localStorage for persistence)

## How to Run
- Served via `npx serve -s . -l 5000 --no-clipboard`
- The workflow "Start application" handles this automatically

## Key Dependencies (loaded via CDN)
- React 18 & ReactDOM
- Leaflet 1.9.4 (maps)
- Leaflet.markercluster 1.5.3
- Leaflet.heat 0.2.0
- Babel Standalone (in-browser JSX transpilation)
- Inter font (Google Fonts)

## Deployment
- Configured as static deployment serving from root directory (`.`)
