# Changelog

## 2026-01-10
- Repointed `live/packages/xavi_social` symlink to the princegeorge copy under `public/packages/xavi_social`.
- Rebuilt the SPA from the active path after the symlink fix.
- Added MCP testing requirement and JWT self-mint reminder to AI instructions.
- Fixed `/social` cache-busting by including `dist/app.js` + `dist/app.css` mtimes in `XAVI_ASSET_VERSION` so SPA rebuilds actually change the asset URLs.
- Added a build stamp (`dist/build.json`) emitted by `scripts/build-frontend.sh` and included it in `XAVI_ASSET_VERSION`.
- Surfaced the build stamp in the SPA “Info” panel to quickly confirm which build is running.
