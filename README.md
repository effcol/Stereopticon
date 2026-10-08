# Stereopticon

<img width="1973" height="1200" alt="Screenshot 2026-05-16 175749" src="https://github.com/user-attachments/assets/2dd2bc5f-2178-4a7a-9251-bb3ca19685f8" />


**A one-stop launcher for stereo 3D and headtracking on PC games.**

Stereopticon orchestrates the major open-source stereo-3D injection tools (Geo-11, wiz3D, UEVR, VRto3D, ReShade-based shaders), and pairs them with headtracking from OpenTrack-protocol sources, letting you play stereoscopic 3D games with optional head-look on standard monitors, SR displays (Acer SpatialLabs, Samsung Odyssey 3D, Asus Spatial Vision, Dimenco), anaglyph glasses, VR headsets via OpenXR, and other 3D-capable hardware.

Stereopticon is **GPL-3.0-only**.

## What's in the repository

```
.                        ← Stereopticon Electron app (GPL v3)
├── src/                 main process (Node)
├── renderer/            UI (HTML/CSS/JS)
├── modules/             per-tool adapters (reshade, uevr, vrto3d, installer, ...)
├── data/                JSON registry — games, fixes, tools, displays, outputs, pipelines
├── scripts/             setup tooling (downloads upstream tools on first run)
├── resources/           bundled tool binaries (downloaded at setup or shipped)
├── assets/              icons / branding
│
├── lib/                 ← third-party SDKs and reference sources
│   ├── Simulated Reality/    LeiaSR SDK (vendor — user-installed platform required)
│   ├── OpenXR-SDK/           Khronos OpenXR reference (Apache 2.0)
│   └── opentrack/            OpenTrack source (ISC) for reference
│
├── COPYING / LICENSE    GPL v3 (the licence of the combined work)
└── Notice.md            third-party attribution for all bundled / fetched components
```

## Architecture

Stereopticon does not inject anything itself. It is an Electron app that:

1. **Reads a JSON registry** (`data/`) of games, available stereo-3D "fixes," tool versions, output formats, and display types.
2. **Resolves a Game → Fix → Tool → Output chain** for the user's selection. (See `Schema.md` for the data model.)
3. **Spawns the selected tool as a child process** with the right config for the chosen output format and display.
4. **Manages headtracking** by spawning OpenTrack and any required bridge (e.g. the LeiaSR head-pose bridge for SR displays) so games receive head-pose data over UDP, even if they don't natively support TrackIR/OpenTrack.

Tools run in their own processes with their own licenses. Stereopticon never links to their code.

## Currently supported tools

| Tool | Role | License |
|---|---|---|
| **Geo-11 / Geo-12** | Modern 3DMigoto-based stereo injector. Primary target for most contemporary fixes. | GPL v3 |
| **wiz3D** | Lightweight stereo injector. | LGPL v2 |
| **UEVR** | praydog's universal Unreal Engine VR injector. | Pending (binaries fetched from official releases) |
| **VRto3D** | SteamVR driver that converts VR output to SBS/TAB for flat 3D displays. | MIT |
| **ReShade + 3DGameBridge / XRGameBridge / 3DtoElse / SuperDepth3D / anaglyph-to-sbs shaders** | Shader-based stereo conversion and SR-weave generation. | BSD / MIT / CC BY 3.0 / GPL v3 |
| **dgVoodoo2** | DirectX 8/9 → DirectX 11 translator for legacy game compatibility. | Free for personal use |
| **OpenTrack** | Headtracking server. Bridges TrackIR / FreeTrack / FaceTrack / etc. into game-readable pose data. | ISC |

See `Notice.md` for full attribution.

## Supported output formats

`sbs` / `sbs_half`, `tab` / `tab_half`, `anaglyph` (red/cyan + variants), `interlaced` (polarized passive 3D), `frame_sequential` (DLP Link / NVIDIA 3D Vision / active shutter), `frame_packing` (HDMI 1.4 3D TVs), `vr_native` (OpenXR / SteamVR), `sr_weave` (Acer SpatialLabs / Samsung Odyssey 3D / Asus Spatial Vision / Dimenco), `lkg_quilt` (Looking Glass holographic displays).

## Status — v5.0.0-alpha.1

Active development. The Electron launcher is buildable; profile library expansion, polished first-run wizard, and full OpenXR Direct-Mode frame-submission are in progress.

## Building

**Stereopticon (Electron launcher):**
```
npm install
npm run setup       # downloads ReShade, UEVR, dgVoodoo2, VRto3D, etc.
npm start
```

## License

Stereopticon as a whole is licensed under **GNU GPL v3.0-only**. See `COPYING` (or `LICENSE`) for the full text and `Notice.md` for third-party attribution.
