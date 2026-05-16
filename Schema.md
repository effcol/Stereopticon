# Stereopticon Data Schema

This document defines the data formats for `data/games/*.json`, `data/pipelines/*.json`, `data/tools/*.json`, and `data/outputs/*.json`.

---

## Architecture: Game → Fix → Tool → Output

The app resolves the rendering chain from the bottom up:

```
game.json
  └─ fixes[]
       ├─ type + tool_version  ──→  data/tools/<type>.json
       │                                └─ versions[tool_version]
       │                                     ├─ native_outputs[]
       │                                     └─ via_pipeline{ output_id: pipeline_id }
       │
       └─ native_outputs (only set on fix when the *game itself* has built-in 3D)
```

**Key principle:** A fix references a tool and optionally a version. The tool definition declares which output formats it natively supports and which secondary pipelines can reach other outputs. Games should not duplicate output lists — they inherit them from the tool.

**Automatic chaining:**
- `graphics_api: "dx9"` → resolver inserts dgVoodoo2 before the fix tool
- `graphics_api: "vulkan"` → resolver considers ShaderGlass wrapping before ReShade addons
- `sr_weave` output on a Geo-11/12 fix → resolver chains `3DGameBridge` automatically

### Example

```
The Witcher 3 (dx11)
  fix: type=geo11, tool_version=v0.6.56
    → tools/geo11.json v0.6.56
      native: sbs_half, tab_half, anaglyph, interlaced, frame_sequential
      via 3DGameBridge: sr_weave

Fallout Shelter (dx11)
  fix: type=anaglyph-to-sbs
    game native_outputs: [anaglyph]   ← game outputs anaglyph natively
    via anaglyph-to-sbs shader: sbs_half, tab_half
```

---

## data/games/*.json

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Unique identifier, snake_case |
| `title` | string | ✓ | Full game title |
| `developer` | string | ✓ | Developer name |
| `graphics_api` | string or array | ✓ | `"dx9"` / `"dx11"` / `"dx12"` / `"vulkan"` / `"opengl"` |
| `steam_app_id` | number | | Steam App ID (auto-scan) |
| `exe_name` | string | | Primary executable filename (auto-scan verification) |
| `default_path` | string | | Default install path hint |
| `fixes` | array | ✓ | Array of fix objects |

### Fix object

#### Identity & source

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique fix ID, snake_case |
| `name` | string | Display name |
| `type` | string | Tool type — see Tool Types below |
| `{type}_version` | string \| object | Specific version of the fix's primary tool. **The field name follows the `type` value**: a `type: "geo11"` fix sets `geo11_version`, a `type: "uevr"` fix sets `uevr_version`, a `type: "wiz3d_wrapper"` fix sets `wiz3d_wrapper_version`, etc. Omit to use the tool's default version (from `data/tools/<type>.json`). Value is usually a string (`"v0.6.56"`, `"Latest stable"`); some tools use an object when the version is composite (e.g. UE3D's `{ uevr_fork, vrto3d_fork, 3dgamebridge_fork }`). |
| `geo11_variant` | string | Geo-11-specific sub-type label: `"Shader Fix"` / `"Acer Official Fix"` / `"DX9 Fix"` etc. Only meaningful when `type === "geo11"`. |
| `authors` | array | Fix author handles or team names |
| `url` | string | Guide / blog post URL |
| `download_url` | string | Direct download URL |
| `download_note` | string | Note shown alongside download button |
| `cost` | string | `"free"` or `"paid"` |
| `cost_url` | string | Purchase URL (if paid) |
| `deprecated` | boolean | `true` = documented for history only |
| `recommended` | boolean | `true` = default/preferred fix for this game |

#### Platform compatibility

```json
"platform": {
  "os": ["windows10", "windows11", "linux"],
  "gpu": ["nvidia", "amd", "intel"],
  "cpu": ["any"],
  "note": "Optional human-readable caveat"
}
```

GPU: omit vendors that are untested/unsupported. If `platform` is omitted, all platforms are assumed.

#### Tool version pinning

```json
"tool_version_pins": {
  "geo11_build": "25.6",
  "uevr_min": "1.0.5",
  "reshade_min": "6.0"
}
```

Use when a fix requires a specific minimum or maximum tool version.

#### Ini / mod configuration

| Field | Type | Description |
|-------|------|-------------|
| `ini_file` | string | Ini filename for Geo-11/12 mods (usually `"d3dxdm.ini"`) |
| `prerequisites` | array | Other tools required before this fix (e.g. `["dgVoodoo2"]`) |
| `reshade_shaders` | array | ReShade shader filenames this fix relies on (e.g. `["3DtoElse.fx"]`). Used by ReShade-based fixes (anaglyph-to-sbs, 3DtoElse, SuperDepth3D, etc.) |
| `post_launch_keys` | array | Keystrokes to send to the game window after launch to activate the fix. Each entry is `{ "key": "F7", "delay_ms": 2000 }`. Used by ReShade fixes that need a hotkey toggle. |

#### Outputs

For most fixes, outputs are resolved from `data/tools/<type>.json`. Only declare these fields when overriding defaults or when the **game itself** provides native 3D output.

| Field | Type | Description |
|-------|------|-------------|
| `rendering_method` | string | `"Dual-View Rendering"` / `"Single-View Depth Reprojection"` |
| `headtracking` | string | Headtracking capability |
| `native_outputs` | array | Outputs natively supported **by the game** (not the tool) |
| `pipeline_overrides` | object | `{ "output_id": ["step", …] }` — override tool chain for a specific output |
| `anaglyph_variant` | string | For native anaglyph games: `"red_cyan"`, `"green_magenta"`, `"amber_blue"` |

#### Display restriction

```json
"display_restriction": {
  "allowed_displays": ["sr_display"],
  "note": "This fix only works on Acer SpatialLabs / SR displays."
}
```

See Display Type IDs below.

#### User-facing info

| Field | Type | Description |
|-------|------|-------------|
| `pros` | string | Strengths of this fix |
| `cons` | string | Weaknesses or caveats |
| `issues` | array | Known problems (strings) |
| `notes` | string | Extended notes shown in detail view |
| `activation` | string | Step-by-step activation instructions |

---

## data/tools/*.json  *(planned)*

Tool definitions live at `data/tools/<type>.json` and declare all known versions plus what each version can output.

```json
{
  "id": "geo11",
  "name": "Geo-11",
  "url": "https://helixmod.blogspot.com",
  "versions": {
    "v0.6.56": {
      "url": "https://...",
      "default": true,
      "native_outputs": ["sbs", "sbs_half", "tab", "tab_half", "anaglyph", "interlaced", "frame_sequential"],
      "via_pipeline": {
        "sr_weave": "3DGameBridge"
      },
      "notes": "Standard stable release. Most game fixes target this version."
    },
    "v0.6.60.23-beta": {
      "url": "https://...",
      "native_outputs": ["sr_weave", "sbs", "sbs_half", "tab", "tab_half", "anaglyph"],
      "notes": "Beta with native SR Weave. No game fixes use this yet."
    },
    "v0.6.196": {
      "url": "https://...",
      "native_outputs": ["sbs", "sbs_half", "tab", "tab_half", "anaglyph"],
      "notes": "Default from Geo-11 website. Newer than v0.6.56 but fewer tested fixes."
    }
  }
}
```

When `tool_version` is omitted on a fix, the app uses the version marked `"default": true`, or the first entry.

---

## data/pipelines/*.json

Pipelines are secondary software layers that convert one output format to another — they sit *after* the fix tool in the chain.

```json
{
  "id": "3DGameBridge",
  "name": "3DGameBridge",
  "description": "ReShade addon that weaves SBS/TAB into SR Weave for SR displays.",
  "url": "https://github.com/3DGameBridgeProjects",
  "cost": "free",
  "input_formats": ["sbs", "sbs_half", "tab", "tab_half"],
  "output_formats": ["sr_weave"],
  "platform": { "os": ["windows10", "windows11"] },
  "requirements": ["ReShade with addon support", "SR Runtime"],
  "display_restriction": { "allowed_displays": ["sr_display"] }
}
```

---

## Tool Types

| `type` | Tool / Framework |
|--------|-----------------|
| `geo11` | Geo-11 (3DMigoto-based, primary stereo fix platform) |
| `geo12` | Geo-12 (SR-focused variant with native SR Weave) |
| `geo3d` | Geo3D (older HelixVision precursor) |
| `3dmigoto` | 3DMigoto raw hook (no Geo layer) |
| `helixmod` | HelixMod (legacy, pre-Geo) |
| `uevr` | UEVR — Unreal Engine VR injector |
| `ue3d` | UE3D Monitor Mode (Evil___Kermit UEVR fork, pre-release) |
| `uuvr` | UUVR — Unity VR injector |
| `wiz3d_wrapper` | wiz3D DX7/8/9/10/11 wrapper — injects stereo into games that don't natively render it (effcol, also covers iZ3D titles + DirectX Automatic Mode games) |
| `wiz3d_3dvision_dm` | wiz3D 3D Vision Direct Mode handler — for D3D9/10/11 games that rendered 3D themselves and submitted to NVIDIA 3D Vision Direct Mode |
| `wiz3d_hd3d` | wiz3D AMD HD3D output handler — for DX11 games that rendered 3D themselves and submitted to AMD HD3D |
| `wiz3d_opengl` | wiz3D OpenGL Quad-Buffer Stereo handler — for OpenGL games that natively support QBS |
| `ogl_3dvision_wrapper` | OpenGL 3D Vision Wrapper (Helifax) — for OpenGL games without native QBS that need 3D Vision Automatic Mode (per-game fixes; NVIDIA-only legacy path) |
| `vireio` | Vireio Perception — bundled D3D9/D3D11 stereo + headtracking engine |
| `vrto3d` | VRto3D — OpenXR → SBS/TAB converter |
| `realvr` | R.E.A.L. VR Mod (paid) |
| `shaderglass` | ShaderGlass — screen-space Vulkan/DX12 capture overlay |
| `reshade_only` | Pure ReShade shader pipeline |
| `native` | Game has built-in stereoscopic 3D |
| `native_legacy` | Legacy driver-based stereo (old nVidia stereo API) |
| `tridef` | TriDef 3D (deprecated) |
| `vorpx` | vorpX (paid VR injector) |
| `vk3dvision` | vk3DVision — Vulkan stereoscopic layer |
| `vks3d` | VKS3D — Vulkan SBS/TAB layer |
| `3dgamebridge` | 3DGameBridge — ReShade addon that weaves SBS/TAB into SR Weave for SR displays |
| `3dconsolebridge` | 3D Console Bridge (NTM3D) — hardware EDID/firmware + bundled 3DToElse-NTM variant shader |
| `xr3dv` | XR3DV — OpenXR → SR Weave |
| `xrgamebridge` | XRGameBridge — OpenXR → SR Weave |
| `3dtoelse` | ReShade 3DtoElse shader |
| `anaglyph-to-sbs` | ReShade/RetroArch anaglyph→SBS or TAB shader |
| `rendepth` | RenDepth 2D→3D depth shader |
| `refract` | Refract ReShade shader (Jared Bienz) |
| `reglass` | ReGlass ReShade shader (Jared Bienz) |
| `superdepth3d` | SuperDepth3D — redirect to **GPUSelector** (BlueSkyDefender's own app, handles SuperDepth3D install + per-game profiles). Not bundled — at author's request, Stereopticon links out rather than reproducing the install path. |
| `reframework` | REFramework (Capcom RE Engine) |
| `portalvr` | PortalVR (PC → Quest 3 → SR display, paid) |
| `iz3d` | iZ3D (legacy) |
| `helixvision` | HelixVision |
| `nomoreflat` | NoMoreFlat |
| `wibblewobble` | WibbleWobbleVR |
| `vrscreencap` | VR screenshot capture pipeline |

---

## Output Format IDs

| ID | Description | Notes |
|----|-------------|-------|
| `sbs` | Full-width side-by-side | Rarely needed — most SBS displays want half-width |
| `sbs_half` | Half-width side-by-side | Standard SBS — default for SBS outputs |
| `tab` | Full-height top-and-bottom | Rarely needed |
| `tab_half` | Half-height top-and-bottom | Standard TAB — default for TAB outputs |
| `anaglyph` | Red/cyan anaglyph | Any monitor + anaglyph glasses |
| `interlaced` | Row-interleaved / polarized | For polarized passive 3D displays |
| `frame_sequential` | Frame sequential / active shutter | DLP Link, VESA 3-pin shutter glasses |
| `frame_packing` | HDMI 1.4 Frame Packing | For 3D TVs with HDMI 1.4 3D input |
| `vr_native` | Native VR (OpenXR / SteamVR) | For VR headsets |
| `sr_weave` | Simulated Reality weave | SR displays (Acer SpatialLabs, Samsung Odyssey 3D, Dimenco) |
| `lkg_quilt` | Looking Glass quilt | Looking Glass holographic displays |

**Removed output IDs (do not use):**
- `nvidia_3d_vision` → use `frame_sequential` with a `platform.note` for 3D Vision driver requirements
- `displayport_3d` → not a distinct format; DP carries `frame_sequential` or `frame_packing` signals

### NVIDIA 3D Vision / active shutter notes

`frame_sequential` is the correct output ID for all active shutter outputs. However:
- **NVIDIA 3D Vision** requires driver 417.xx or older, a NVIDIA 900/1000-series GPU (or Quadro), and a 3D Vision-certified monitor. Not compatible with any current driver.
- **DLP Link** and generic VESA active shutter displays accept `frame_sequential` via HDMI without driver restrictions.
- Geo-11's `frame_sequential` works with 3D Vision hardware (old driver) and some generic active shutter displays.
- When targeting 3D Vision specifically, add `"platform": { "gpu": ["nvidia"], "note": "Requires NVIDIA driver 417.xx or older. 3D Vision-certified monitor required." }`.

---

## Display Type IDs

Used in `display_restriction.allowed_displays` to restrict a fix to specific display hardware.

| ID | Display hardware |
|----|-----------------|
| `sr_display` | Acer SpatialLabs, Samsung Odyssey 3D, Dimenco (Simulated Reality) |
| `looking_glass` | Looking Glass holographic display |
| `anaglyph` | Any monitor + anaglyph glasses |
| `polarized` | Polarized passive 3D display + passive glasses |
| `shutter` | Active shutter display (DLP Link, VESA, or 3D Vision hardware) |
| `hdmi_3d` | HDMI 1.4 3D TV (Frame Packing input mode) |
| `ar_glasses` | AR glasses in SBS mode (Xreal, Viture, etc.) |
| `vr_headset` | VR headset (any OpenXR device) |
| `sbs_generic` | Any display with an SBS input mode |
| `tab_generic` | Any display with a TAB input mode |

**Removed:** `leia_tablet` (Leia / Nubia Pad 3D is not a Windows PC display and is no longer supported).

---

## Runtime Registry

The app loads all JSON files at startup and builds a flat in-memory registry:

```js
registry = {
  games:     { [game.id]: game },         // data/games/*.json
  pipelines: { [pipeline.id]: pipeline }, // data/pipelines/*.json
  tools:     { [tool.id]: tool },         // data/tools/*.json  (planned)
  outputs:   { [output.id]: outputDef },  // data/outputs/*.json
}
```

This already exists as `PIPELINES`, `OUTPUT_DEFINITIONS`, and `gamesData` in the renderer, backed by `loadGames()` / `loadPipelines()` / `loadOutputs()` IPC handlers. A `loadTools()` handler will be wired when `data/tools/` is populated.

The registry stays flat — game data is resolved at selection time, not at load. This scales to thousands of games with no performance concern (flat object lookup is O(1) per game).