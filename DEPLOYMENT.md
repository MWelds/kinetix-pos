# Kinetix POS — Deployment Guide

## Overview

Kinetix POS is packaged as a Windows desktop app using `electron-builder`.
Releases are published to **GitHub Releases** and the app auto-updates in the
background — users just get a notification to restart.

---

## Prerequisites

- **Node.js 20+** installed on your build machine
- **Git** installed
- A **GitHub account** (username: `mavwelds`)
- The repo created at: `https://github.com/mavwelds/kinetix-pos`

---

## One-Time Setup (do this once)

### 1. Create the GitHub repository

Go to https://github.com/new and create a **public** repository named `kinetix-pos`.
(It must be public for free GitHub Releases. You can use a private repo with a
GitHub Pro account.)

### 2. Initialize git and push the code

Open a terminal in the project folder (`C:\Claude Projects\POS\POS`) and run:

```bash
git init
git config user.email "mavwelds@gmail.com"
git config user.name "Mavrick Welds"
git checkout -b main
git add .
git commit -m "Initial release v1.0.0"
git remote add origin https://github.com/mavwelds/kinetix-pos.git
git push -u origin main
```

### 3. Create your first release tag

```bash
git tag v1.0.0
git push origin v1.0.0
```

This triggers the GitHub Actions workflow which builds the Windows installer and
uploads it to GitHub Releases automatically.

### 4. Download the installer

After the build finishes (~5–10 min), go to:
`https://github.com/mavwelds/kinetix-pos/releases`

Download `Kinetix POS-1.0.0-Setup.exe` and distribute it to your machines.

---

## Pushing a Bug Fix or Update

Every subsequent release is just 3 commands:

```bash
# Patch release (1.0.0 → 1.0.1) — use for bug fixes
npm version patch

# Minor release (1.0.0 → 1.1.0) — use for new features
npm version minor

# Then push the code and the new tag together
git push && git push --tags
```

That's it. GitHub Actions builds the new installer and publishes it. Any running
instance of Kinetix POS will download the update silently in the background and
show a notification: **"Update downloaded — restart Kinetix POS to install."**

The update installs automatically when the app is closed and reopened.

---

## Building Locally (without publishing)

To produce an installer on your own machine without uploading anywhere:

```bash
# Rebuild native modules first (required after npm install)
npm run rebuild

# Build the installer
npm run dist
```

Output files appear in `dist/`:
- `Kinetix POS-X.X.X-Setup.exe` — NSIS installer (recommended)
- `Kinetix POS-X.X.X-Portable.exe` — single file, no installation needed

---

## How Auto-Updates Work

1. On every launch, the app silently checks GitHub Releases for a newer version.
2. If found, it downloads in the background (no interruption to the user).
3. When the download completes, a toast notification appears:
   _"Update downloaded — restart Kinetix POS to install the latest version."_
4. The update installs automatically on the next close/reopen.

The app also re-checks every **4 hours** while running.

---

## GitHub Actions

The workflow file is at `.github/workflows/release.yml`. It runs on `windows-latest`
and uses the built-in `GITHUB_TOKEN` secret — no extra configuration needed.

---

## Troubleshooting

**Build fails with "better-sqlite3" error**
Run `npm run rebuild` before `npm run dist` to recompile the native module for
the target Electron version.

**"Unknown publisher" warning on install**
This is Windows SmartScreen. For internal deployments, click "More info → Run anyway".
For public distribution, purchase a code-signing certificate and add it to the
`win` section of `package.json`.

**Auto-update not working**
- Make sure the GitHub repository is public (or you have GitHub Pro for private repos).
- Check that the version in `package.json` is higher than the installed version.
- The updater only runs in production builds — not in `npm run dev`.
