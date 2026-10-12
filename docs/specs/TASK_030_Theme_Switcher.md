---
type: specification
title: TASK 030: Theme Switcher & Asset Decoupling
---

# TASK 030: Theme Switcher & Asset Decoupling

## Architecture Overview
The Gelt Terminal web interface has been refactored to support multiple visual themes pulled via Google Stitch while maintaining a single, decoupled JavaScript file for data polling.

### JavaScript Decoupling
The polling and WebSocket logic previously embedded within `index.html` has been extracted to `pkg/server/web/static/app.js`.
This shared script is linked in all theme HTML files. It uses DOM checks (`if (elStatus)`) to ensure that missing elements in certain themes do not cause JavaScript errors, preserving stability across variations.

### Theme Routing (`pkg/server/static.go`)
The Go HTTP server routing has been updated. The root handler (`/`) now inspects the `theme` query parameter (e.g., `/?theme=glass`).
- Default: `theme_cyberpunk.html`
- Glassmorphic: `theme_glass.html`
- Blueprint: `theme_blueprint.html`
- Retro-Analog: `theme_retro.html`

Other static assets, including `app.js`, are served normally.

### User Interface
A theme selector dropdown has been injected into the top right corner of all theme templates, allowing users to dynamically switch between the 4 available visual aesthetics.
