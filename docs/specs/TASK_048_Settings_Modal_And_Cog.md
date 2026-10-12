---
type: specification
title: TASK 048: Dedicated Settings Modal & UI Cog Navigation
---

# TASK 048: Dedicated Settings Modal & UI Cog Navigation

## Objective
Implement a clean, consistent top-right settings cog icon across all four Gelt terminal themes (Cyberpunk, Glassmorphic, Blueprint, Retro-Analog) that opens a dedicated Settings overlay modal housing the theme switcher.

## Execution Steps

### 1. Global Navigation Update (HTML Templates)
- Updated `pkg/server/web/theme_cyberpunk.html`, `pkg/server/web/theme_glass.html`, `pkg/server/web/theme_blueprint.html`, and `pkg/server/web/theme_retro.html`.
- Removed the old inline theme selector (`<select id="theme-select">`).
- Replaced it with a fixed top-right navigation header containing a button (`id="settings-cog-btn"`) with a `<span class="material-symbols-outlined">settings</span>` icon.

### 2. Settings Modal Scaffolding (HTML & CSS)
- Appended a hidden settings modal container (`id="settings-modal"`) to all four HTML templates just before the closing `</body>` tag.
- Built a UI containing a header ("Terminal Settings") and a close button (`id="settings-close-btn"`).
- Added a section "Select Theme" containing four buttons (`.theme-btn`), one for each available theme, passing their respective values as `data-theme`.

### 3. Frontend Interaction Logic (`app.js`)
- Updated `pkg/server/web/static/app.js` with `initSettingsModal()` logic.
- Wired click events to open (`settings-cog-btn`) and close (`settings-close-btn` or clicking outside the modal) the modal.
- Highlighted the currently active theme by evaluating `window.location.search`.
- Wired click events on theme buttons (`.theme-btn`) to trigger a `window.location.href = '/?theme=' + theme` redirect, mirroring prior behavior but with an enhanced UI.
- Initialized this logic inside the `DOMContentLoaded` event listener.

## Testing & Validation
- Ran integration checks to confirm settings cog opens seamlessly across all themes.
- Re-ran the backend unit test suite using `go test ./...` to guarantee the underlying static file serving logic in `pkg/server/static.go` was undisturbed.
