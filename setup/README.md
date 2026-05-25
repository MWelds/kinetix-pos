# Setup Scripts

This folder contains scripts to get your development environment ready on Windows.

## Quick Start

**Just double-click `setup.bat`** — it handles everything automatically.

---

## What each file does

| File | Purpose |
|------|---------|
| `setup.bat` | Double-clickable launcher — runs the PowerShell script |
| `Install-Prerequisites.ps1` | Main setup script (Node.js, VS Build Tools, npm install, rebuild) |
| `Check-Environment.ps1` | Read-only check — shows what's installed without changing anything |

---

## What the setup installs

### 1. Node.js LTS (v20+)
Required to run the app in development and build the installer.
- Installed via **winget** if available (Windows 10 1809+ / Windows 11)
- Falls back to direct MSI download from nodejs.org

### 2. Visual Studio Build Tools 2022
Required to compile **better-sqlite3**, the native SQLite addon.
- Installs the **Desktop development with C++** workload
- Download is ~1.5 GB — the script asks for confirmation first
- If you already have Visual Studio 2019/2022 installed, this step is skipped

### 3. npm dependencies
Runs `npm install --legacy-peer-deps` in the project root.

### 4. Native module rebuild
Runs `npm run rebuild` to compile better-sqlite3 against your installed Electron version.

---

## Running manually (step by step)

If you prefer to install prerequisites yourself:

```powershell
# 1. Install Node.js 20 LTS from https://nodejs.org  (or via winget)
winget install OpenJS.NodeJS.LTS

# 2. Install Visual Studio Build Tools
#    https://visualstudio.microsoft.com/visual-cpp-build-tools/
#    Select: "Desktop development with C++"

# 3. Open a new terminal (so PATH is refreshed), then:
cd "C:\Claude Projects\POS\POS"
npm install --legacy-peer-deps
npm run rebuild

# 4. Launch the app
npm run dev
```

---

## Troubleshooting

### "node-pre-gyp failed" or "better_sqlite3.node not found"
VS Build Tools aren't installed or weren't detected. Re-run `setup.bat` and confirm the Build Tools install when prompted.

### "npm not recognized"
Node.js isn't on your PATH. Close and reopen the terminal after installing Node.js, then try again.

### PowerShell execution policy error
Run this once in an elevated PowerShell:
```powershell
Set-ExecutionPolicy RemoteSigned -Scope LocalMachine
```

### Setup script won't elevate (corporate policy)
Ask your IT team to install the prerequisites, or use the manual steps above.
