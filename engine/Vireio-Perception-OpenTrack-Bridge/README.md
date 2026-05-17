# Vireio Perception OpenTrack Bridge

> The headtracking-only build flavour of **Vireio Perception v5** — a thin
> d3d9 proxy that pipes OpenTrack head pose into a DX9 game's view matrix,
> with no stereo rendering. Composes cleanly with any stereo3D mod (Geo-11,
> wiz3D, ReShade, native HD3D) or runs on a flat 3D display that just needs
> headtracking. Full stereo + HT lives in the sister build at
> [`engine/vireio/Perception_v3/`](../vireio/Perception_v3/) (Vireio
> Perception v5 — being modernized in-place from the v3 source).

A standalone head-tracking-only proxy DLL. Drops into a game's folder,
listens for OpenTrack UDP head pose on port 4242, and applies that pose to
the game's view matrix via Direct3D 9 interception.

No Inicio injection. No Aquilinus workspaces. No stereo rendering. Just
view-matrix rotation from incoming head pose, so it composes cleanly with
any stereo3D mod (Geo-11, wiz3D, native AMD HD3D, etc.) or with native 3D
games that don't need stereo injection.

This project lives inside the [Stereopticon](https://github.com/effcol/Stereopticon)
repo for source-tree convenience, but it is **self-contained**: the folder
can be copied out and built independently, or mirrored to its own repository.

## License

LGPL-v3. Full text is in [`LICENSE`](LICENSE) next to this README.

You can:
- Use the prebuilt DLL as-is (drop it into your game folder).
- Rebuild from source and replace the DLL — the LGPL "user must be able
  to substitute the library" condition is satisfied by the build
  instructions below.
- Redistribute the source under LGPL-v3, including from a separate repo
  or mirror.

If you redistribute binaries elsewhere (your own GitHub releases page,
nightly artifacts), include a copy of `LICENSE` alongside them.

## Architecture

```
                                          OpenTrack hub
                                         (UDP 4242, FreeTrack 2.0)
                                                │
                                                ▼
[ game.exe ]  ← LoadLibrary("d3d9.dll")  ← d3d9.dll (this project)
                                              │
                                              │  forwards every D3D call to
                                              │   the real d3d9.dll except
                                              │   SetTransform(D3DTS_VIEW),
                                              │   which gets the head pose
                                              │   composed onto it
                                              ▼
                                       real d3d9.dll  (System32)
```

The proxy DLL is dropped next to the game's exe. Windows's DLL-search-order
rule loads our proxy first; our proxy forwards to the system DLL.

## Proxy slot collisions

Because wiz3D / Geo-11 / ReShade can also install themselves as `d3d9.dll`,
this project ships **two binary variants** from the same source:

| Variant   | Output         | When to use                                                                       |
|-----------|----------------|-----------------------------------------------------------------------------------|
| `d3d9`    | `d3d9.dll`     | Default. Works for any DX9 game with no other d3d9 proxy installed.              |
| `dinput8` | `dinput8.dll`  | Drop-in when wiz3D / Geo-11 / ReShade already owns the `d3d9.dll` slot.          |

When the `dinput8` variant is used, the install routine also stages a copy
of `%SystemRoot%\System32\dinput8.dll` into the game folder as
`dinput8_orig.dll` so real input traffic forwards through unchanged.

`winmm.dll` / `version.dll` slot variants are wired in `CMakeLists.txt` but
disabled — uncomment them if neither d3d9 nor dinput8 is free.

Stereopticon's adapter (`modules/adapters/vireio.js`) auto-detects which
slot is free in the target game folder and picks the right variant.

## File layout when shipped

```
<game-folder>/
├── game.exe
├── d3d9.dll               ← THIS PROJECT (or dinput8.dll for the alternate slot)
├── dinput8_orig.dll       ← only for the dinput8 variant — copy of real system DLL
└── vireio-ht.ini          ← optional config (port, axis mapping, deadzone)
```

## Build

Standard CMake + Visual Studio:

```
cd engine/Vireio-Perception-OpenTrack-Bridge
cmake -S . -B build -A Win32        # 32-bit games (the common case for DX9)
cmake --build build --config Release
```

For 64-bit DX9 games, swap `-A Win32` for `-A x64` into a separate
`build64/` directory.

Outputs land under `build/Release/`:
- `d3d9.dll`
- `dinput8.dll`

Built binaries are **not** committed to this repo — `build/` and
`releases/` are gitignored. Distribute binaries via the separate
[Vireio-Perception-OpenTrack-Bridge GitHub Releases page](https://github.com/effcol/Vireio-Perception-OpenTrack-Bridge/releases)
once that mirror exists.

## Source layout

| File                          | Role                                                                                  |
|-------------------------------|---------------------------------------------------------------------------------------|
| `src/main.cpp`                | `DllMain`, exported `Direct3DCreate9` entry                                            |
| `src/d3d9_proxy.cpp`          | `IDirect3D9` / `IDirect3DDevice9` forwarding wrappers, `SetTransform` interception     |
| `src/opentrack_listener.cpp`  | UDP listener for FreeTrack 2.0 protocol on port 4242                                   |
| `src/headpose_matrix.cpp`     | Build a D3DMATRIX from yaw/pitch/roll/x/y/z, compose with the game's view matrix      |
| `src/config.cpp`              | Load vireio-ht.ini (axis inversion, deadzone, sensitivity)                             |
| `src/d3d9_exports.def`        | Export shape for the `d3d9.dll` variant                                                |
| `src/dinput8_exports.def`     | Export shape for the `dinput8.dll` variant (forwards to `dinput8_orig.dll`)            |

## Game support

The proxy hooks `IDirect3DDevice9::SetTransform(D3DTS_VIEW, ...)`. That's
the **fixed-function** D3D9 pipeline — meaning it works on games that
push the view matrix through `SetTransform`, and not (yet) on games that
push the view matrix into a vertex-shader constant via
`SetVertexShaderConstantF`. A shader-constant intercept is on the roadmap.

### Confirmed working

> *Tested-and-reported* list. Currently empty — the proxy is in initial
> scaffolding state. Once a build is verified on a game, list it here
> with the OpenTrack input it was tested against.

| Game | Engine | Variant | Tested by | Notes |
|------|--------|---------|-----------|-------|
| _none yet_ | _—_ | _—_ | _—_ | _—_ |

### Strong candidates (likely to work)

Fixed-function D3D9 games from roughly the 2002–2008 era. Worth trying:

| Game | Engine | Why it should work |
|------|--------|--------------------|
| Half-Life 2 / Episodes 1 & 2 | Source (pre-2007) | FFP `SetTransform` for many world transforms |
| Portal | Source | Same engine pipeline as HL2 |
| Counter-Strike: Source | Source | Same engine pipeline as HL2 |
| Doom 3 (D3D9 wrapper) | id Tech 4 | Renderer uses fixed transforms |
| Quake 4 | id Tech 4 | Renderer uses fixed transforms |
| Return to Castle Wolfenstein | id Tech 3 (D3D9 port) | Pre-shader-constant view matrix |
| Quake III Arena (D3D9 port) | id Tech 3 | Pre-shader-constant view matrix |
| The Elder Scrolls III: Morrowind | Gamebryo (D3D9) | FFP view matrix |
| The Elder Scrolls IV: Oblivion | Gamebryo (D3D9) | Mixed — view matrix often via SetTransform |
| Unreal Tournament 2004 | Unreal Engine 2 (D3D9 renderer) | FFP pipeline |
| Far Cry 1 | CryEngine 1 | FFP transforms |
| Painkiller | PainEngine | FFP transforms |
| F.E.A.R. | Lithtech Jupiter EX | FFP transforms |
| Deus Ex: Invisible War | Unreal Engine 2 | FFP pipeline |
| Trackmania Nations / United Forever | TrackMania engine | Older D3D9 FFP |
| Need for Speed: Most Wanted (2005) | EAGL | FFP transforms |
| Need for Speed: Carbon | EAGL | FFP transforms |

This is a "should work" list, not a "definitely works" list — until each
title is actually tested, treat the entries as candidates. Open an issue
with results either way.

### Likely not to work (yet)

These need the planned `SetVertexShaderConstantF` intercept:

| Engine / Game category | Why it's blocked |
|------------------------|------------------|
| Unreal Engine 3 (BioShock 1/2, Mass Effect 1–3, Borderlands 1, Mirror's Edge, Gears of War PC) | View matrix uploaded as a shader constant; no `SetTransform` call to intercept |
| Source post-2007 (TF2, L4D, L4D2, Portal 2) | Largely shader-constant view matrices |
| Skyrim / Fallout 3 / Fallout: New Vegas | Gamebryo's later D3D9 path pushes view to shader constants |
| Crysis (DX9 mode) | CryEngine 2 uses shader constants |

### Out of scope (for this proxy)

These need an entirely different proxy (planned as a sister project):

| API | Plan |
|-----|------|
| DX10 / DX11 | `Vireio-Perception-OpenTrack-Bridge-D3D11` — hooks `Map` / `Unmap` on dynamic constant buffers |
| DX12 | TBD — requires command-list interception, much heavier |
| Vulkan | TBD — layer-based approach (similar pattern to wiz3D's OpenGL layer) |
| OpenGL | TBD — similar layer approach |

If you want headtracking on a game that's not covered here, use Stereopticon's
**Loop mod** path (Mono.Cecil-based, works for Unity titles) or the engine-native
HT in titles that support FreeTrack/OpenTrack directly.

## Status

⚠️ **Initial scaffolding** — code compiles in principle but has no real-game
testing yet. The `IDirect3DDevice9` proxy covers the common SetTransform
path; per-game testing will reveal which titles need the shader-constant
intercept that's on the roadmap.

## Why this exists separately from the main Vireio engine

The main Vireio v4 engine (Aquilinus + plugin system) is a big piece of
infrastructure for full stereo + headtracking + multi-platform output.
For users who **only** want head tracking on top of an unrelated stereo
mod, all that machinery is overkill. The standalone proxy is ~500 lines
of focused C++ that ships as a single DLL — same install ergonomics as
Loop mods, no engine framework needed.

Stereopticon's adapter at `modules/adapters/vireio.js` detects when the
user has picked Vireio Perception as the HT Fix alongside a non-Vireio
stereo fix, and deploys this proxy DLL into the game folder rather than
spawning Inicio.
