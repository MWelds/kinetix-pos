# Build Resources

This folder contains assets used by electron-builder when creating the Windows installer.

## Files

| File | Purpose |
|------|---------|
| `icon.ico` | App icon — used for the installer, desktop shortcut, and taskbar |
| `installer.nsh` | Custom NSIS script — adds Windows version check and registry entries |

## Replacing the Icon

The included `icon.ico` is a placeholder. Replace it with your real app icon before building for distribution.

**Requirements:**
- Format: `.ico`
- Recommended sizes embedded in the ICO: 16×16, 32×32, 48×48, 256×256
- Color depth: 32-bit (RGBA)

**Free tools to create an ICO:**
- https://www.icoconverter.com/ — upload a PNG, download ICO
- https://redketchup.io/icon-editor — free online editor
- Inkscape (open source) → File → Export → ICO format

If you have a PNG logo, a 256×256 version works well as the source.
