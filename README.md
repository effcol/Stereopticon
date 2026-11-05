# Stereopticon

<img width="1973" height="1200" alt="Screenshot 2026-05-16 175749" src="https://github.com/user-attachments/assets/2dd2bc5f-2178-4a7a-9251-bb3ca19685f8" />


**A launcher for playing PC games in stereo 3D.**

Stereopticon finds your games, installs the right stereo 3D mod for each one, sets the output for your display and launches the game. Version 0.1 is a front end for [wiz3D](https://github.com/effcol/wiz3D), the universal stereo injector for DirectX 7 to 11 and OpenGL games. Support for other mods (Geo-11, UEVR, ReShade-based conversion, head tracking) is in the code and will be switched on tool by tool as each is tested.

Stereopticon is licensed under the **GNU LGPL v2.1 or later**, the same licence as wiz3D.

## Download

Get the latest version from the [Releases page](https://github.com/effcol/Stereopticon/releases). Two files are offered:

| File | Use it if |
|---|---|
| `Stereopticon-Setup-<version>.exe` | You want a normal install with a Start menu entry and an uninstaller. |
| `Stereopticon-<version>-portable.zip` | You want to run it from any folder without installing. Unzip and run `Stereopticon.exe`. |

Windows only (64-bit Windows 10 or 11). The builds are not code-signed yet, so Windows SmartScreen may say it "protected your PC" the first time: choose **More info**, then **Run anyway**.

You do not need Node.js, git or any other developer tools to use these builds.

## Using it

1. **Pick your display and output** in Settings (the gear, bottom left): for example Simulated Reality for an Acer SpatialLabs or Samsung Odyssey 3D, Half Side-by-Side for a 3D TV or AR glasses, or Anaglyph for red/cyan glasses.
2. **Choose a game** from the library. It lists the games wiz3D has an entry for; the **wiz3D status** filters show which are reported working. Games installed through Steam are found automatically; for others, set the game folder with the folder button.
3. **Install wiz3D** for that game. The first time, Stereopticon downloads the latest wiz3D release from GitHub. It reads the game's .exe to pick the right build (DirectX version, 32-bit or 64-bit) and copies it next to the .exe.
4. **Launch**. Stereopticon writes your output mode into wiz3D's config just before the game starts.

To remove wiz3D from a game, use the bin button on the game page. It deletes only the files that were added and puts back any game files that were replaced.

Settings → wiz3D shows which wiz3D version you have and offers new releases. After updating, a game set up with the older version shows **Update wiz3D here**.

### Output modes

wiz3D can output half or full side-by-side, half or full top-and-bottom, red/cyan anaglyph, row or column interleaved, checkerboard, and Simulated Reality weave (Acer SpatialLabs, Samsung Odyssey 3D, Asus Spatial Vision, Dimenco).

## Building from source

You need [Node.js](https://nodejs.org) 22 or later. On Windows: `winget install OpenJS.NodeJS.LTS`.

```
git clone https://github.com/effcol/Stereopticon.git
cd Stereopticon
npm install
npm start
```

Or double-click `Stereopticon.cmd`, which installs dependencies on first run and starts the app from the current source.

| Command | What it does |
|---|---|
| `npm start` | Run the app from source. |
| `npm test` | Run the tests. |
| `npm run bundle` | Rebuild the catalogue index (`data/_bundle.json`, `data/_sidebar.json`) after editing `data/games/`. |
| `npm run dist` | Build the installer and portable zip into `dist/`. |

### Releasing

Set `"version"` in `package.json`, commit, then push a matching tag:

```
git tag v0.1.0
git push origin v0.1.0
```

The [Release workflow](.github/workflows/release.yml) runs the tests, builds both files and attaches them to a **draft** release for that tag. Write the notes on the Releases page and publish it. The [CI workflow](.github/workflows/ci.yml) runs the tests on every push.

## What's in the repository

```
.
├── src/          Electron main process
├── renderer/     UI (HTML, CSS, JS)
├── modules/      installers and per-tool adapters; wiz3dManager.js fetches wiz3D releases
├── data/         catalogue: games, fixes, tools, displays, outputs, pipelines
├── scripts/      data generators, setup and build helpers
├── test/         tests (node:test)
├── assets/       icon
└── resources/    downloaded tools during development (not in git)
```

Stereopticon does not inject anything into games itself. It installs and configures the tools that do, which run under their own licences.

## Licence

Stereopticon is licensed under the **GNU Lesser General Public License v2.1 or later** (`LGPL-2.1-or-later`). See `LICENSE` for the full text and `Notice.md` for third-party attribution.

Versions published before 22 October 2026 were released under GPL v3 and remain available under that licence.

The ReShade shaders in `resources/shaders-src/` keep their own licences, stated at the top of each file: `Anaglyph_to_SBS_or_TAB.fx` and `Pulfrich_to_SBS_or_TAB.fx` are GPL-3.0-or-later, and `3DtoElse.fx` is CC BY 3.0.
