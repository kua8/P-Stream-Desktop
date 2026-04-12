Discord RPC overhaul and improvements over v1.0.1.

# What's Changed

**New Features**
- Complete Discord RPC rewrite with automatic media detection
- Real-time progress tracking with live timestamps
- Automatic metadata extraction (show names, episodes, poster images)
- Dynamic titlebar updates showing current media and playback state

**Bug Fixes**
- Fixed Discord RPC not clearing when video stops
- Fixed paused state showing incorrect timer (now freezes progress bar)
- Fixed ruleId validation errors for stream preparation
- Fixed DevTools auto-opening on startup

**Improvements**
- Discord now shows "Watching [Title]" with proper formatting
- TV shows display as "Show | S3 E5" format
- Titlebar shows "Show · S3 E5 · Watching/Paused"
- Cleaned up excessive debug logging
- Better error handling in media metadata extraction

**Known Issues**
- Native app recognition temporarily disabled
- Userscript injection disabled (will be fixed in v1.0.3)

---

**Full Changelog:** [`v1.0.1...v1.0.2`](https://github.com/kua8/P-Stream-Desktop/compare/v1.0.1...v1.0.2)
