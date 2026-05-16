# Vireio HT Proxy

A standalone head-tracking-only proxy DLL. Drops into a game's folder,
listens for OpenTrack UDP head pose, and applies that pose to the game's
view matrix via D3D9 / D3D11 interception.

No Inicio injection. No Aquilinus workspaces. No stereo rendering. Just
view-matrix rotation from incoming head pose, so it composes cleanly with
any stereo3D mod (Geo-11, wiz3D, native AMD HD3D, etc.) or with native 3D
games that don't need stereo injection.

## Architecture

```
                                          OpenTrack hub
                                         (UDP 4242, FreeTrack 2.0)
                                                │
                                                ▼
[ game.exe ]  ← LoadLibrary("d3d9.dll")  ← vireio-ht.dll (this project)
                                              │
                                              │  (forwards every D3D call
                                              │   to the real d3d9.dll,
                                              │   except SetTransform with
                                              │   D3DTS_VIEW — that gets
                                              │   the head pose applied)
                                              ▼
                                       real d3d9.dll
```

The proxy DLL is renamed `d3d9.dll` (or `d3d11.dll` for the DX11 variant)
and dropped next to the game's exe. Windows's DLL-search-order rule loads
our proxy first, our proxy forwards to the system one. Same trick wiz3D
uses for stereo injection — we just do rotation instead.

## File layout when shipped

```
<game-folder>/
├── game.exe
├── d3d9.dll                 ← THIS PROJECT (renamed from vireio-ht.dll)
└── vireio-ht.ini            ← optional config (port, axis mapping, deadzone)
```

`d3d9_real.dll` (a symlink/copy of the system d3d9.dll) is also expected
in some setups — most games work without it because Windows resolves
forwarded calls through `LoadLibrary("C:\Windows\System32\d3d9.dll")`
inside the proxy.

## Build

Standard CMake-Visual-Studio project, x86 + x64:

```
cd engine/vireio-ht-proxy
cmake -S . -B build -A Win32
cmake --build build --config Release
```

Outputs `build/Release/vireio-ht.dll`. Rename to `d3d9.dll` when deploying.

## Source layout

| File | Role |
|------|------|
| `src/main.cpp`               | `DllMain`, exported `Direct3DCreate9` entry |
| `src/d3d9_proxy.cpp`         | `IDirect3D9` / `IDirect3DDevice9` forwarding wrappers, `SetTransform` interception |
| `src/opentrack_listener.cpp` | UDP listener for FreeTrack 2.0 protocol on port 4242 |
| `src/headpose_matrix.cpp`    | Build a D3DMATRIX from yaw/pitch/roll/x/y/z, compose with the game's view matrix |
| `src/config.cpp`             | Load vireio-ht.ini (axis inversion, deadzone, sensitivity) |

## Status

⚠️ **In progress.** Scaffolding committed. The `IDirect3DDevice9` proxy
covers the common SetTransform path but you'll need per-game testing for
games that use shader-constant view matrices (a few UE3 / late-DX9 titles
push the view matrix into shader constants directly, bypassing the
fixed-function `SetTransform`). For those, a `SetVertexShaderConstantF`
intercept will need to be added.

DX11 variant (`vireio-ht-d3d11/`) is a separate sister project — same
idea but hooks `Map` / `Unmap` on dynamic constant buffers to find and
rotate the view matrix. That's a follow-up.

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
