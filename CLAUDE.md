# Claude Code Agent Guide

> This file must be kept up-to-date. **Update CLAUDE.md with each commit** if the changes affect project structure, build process, or key workflows. Keep it concise and relevant.

## Project Summary

**Al-Azan** is an Android-only Islamic prayer times app built with React Native 0.74.5 and TypeScript (strict mode).

- **Package**: `com.github.meypod.al_azan`
- **Version**: 1.17.10
- **Key Features**: Prayer times, Qibla finder, Adhan audio, widgets, reminders

## Quick Commands

```bash
# Setup (first time)
yarn install
cp lingui.config.js.example lingui.config.js
yarn lingui compile

# Development
yarn start              # Metro bundler
yarn android            # Build & run debug
yarn test               # Run tests
yarn lint-fix           # Fix linting issues

# Release build
cd android && ./gradlew :app:assembleRelease -PnoSign -PuseLegacyPackaging=true
```

## Project Structure

```
src/
├── screens/        # UI screens (home, settings, qibla_finder, etc.)
├── store/          # Zustand stores with MMKV persistence
├── tasks/          # Background scheduling (alarms, widgets)
├── modules/        # Native module bridges (media_player, compass)
├── adhan/          # Prayer time calculations
├── components/     # Reusable UI components
├── services/       # Business logic (audio_service)
└── utils/          # Helper functions

android/app/src/main/java/com/github/meypod/al_azan/
├── modules/        # Native Java modules
├── MainActivity.kt
└── PrayerTimesWidget.java
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app.tsx` | Root navigation, theme setup |
| `src/bootstrap.ts` | App initialization |
| `src/adhan/prayer_times.ts` | Prayer calculation logic |
| `src/store/settings.ts` | App settings store |
| `src/store/calculation.ts` | Prayer calculation params |
| `src/tasks/set_next_adhan.ts` | Alarm scheduling |

## Code Style

- **Imports**: Use `@/` alias (e.g., `import {x} from '@/store/settings'`)
- **Bracket spacing**: `{key: value}` (no spaces)
- **Quotes**: Single quotes
- **Trailing commas**: Always
- **Arrow parens**: Avoid when possible (`x => x`)

## State Management

All state uses **Zustand + MMKV**:

```typescript
import {useSettings} from '@/store/settings';
const [theme, setTheme] = useSettings('SELECTED_THEME');
```

## Important Constraints

- **Android only** - no iOS code
- **TypeScript strict mode** - fix all type errors
- **No console.logs** in production (removed by Babel)
- **Run `yarn lint-fix`** before committing
- **Run `yarn lingui compile`** if translations change

## CI/CD

GitHub Actions workflow (`.github/workflows/build_and_deploy.yml`):
- Triggers on: releases, PRs, push to main/master
- Builds and signs APK
- Uploads signed APK as artifact with download link in job summary

## Documentation

- **[AGENT.md](./AGENT.md)** - Detailed agent guide with code examples
- **[PROJECT.md](./PROJECT.md)** - Comprehensive technical documentation

## Commit Rules

1. Follow conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
2. **Update this CLAUDE.md** if changes affect:
   - Project structure or new directories
   - Build process or commands
   - Key workflows or patterns
   - Important file additions/removals
3. Keep updates minimal - only document what's essential for agent operation
4. Remove outdated information rather than letting it accumulate

---
*Last updated: 2026-01-29*
