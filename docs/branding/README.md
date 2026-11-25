# Open tools icon family

| App | Icon | Source |
| --- | --- | --- |
| OS Installation Tool | <img src="../../packages/web/public/icon.svg" width="56" alt="Blue Os tile"> | [Os, sky blue](../../packages/web/public/icon.svg) |
| Windows Cleaner (proposed) | <img src="./cleaner.svg" width="56" alt="Mint Cl tile"> | [Cl, mint green](./cleaner.svg) |

Each tile has a dark ground, a light two-letter monogram and a short corner mark
at the top left. Use a different letter pair **and** hue for each app, so color
is not the only way to tell the tools apart. For example, a backup utility could
use **Bk** in amber. Keep the 64-unit square, 2-unit inset and 13-unit corner
radius when adding a sibling. Use paths rather than fonts for predictable rendering.

The Os SVG is the web favicon and in-app mark. The desktop build rasterizes that
same source at 512 pixels and electron-builder derives the Windows icon from it.
Edit the SVG, rebuild the web app, then rebuild the desktop package. No manual
icon export or installed font is required. The Cl SVG is ready for the cleaner
project to adopt; it is not bundled into the USB app.

These original assets use the project's MIT license.
