# Stereopticon — Third-Party Software Notices

Stereopticon is free software licensed under the GNU General Public License v3.0 (see `COPYING`).
This file acknowledges the third-party components distributed with or fetched by this software.

## Distribution model

Stereopticon ships only its own source. The tools it drives (wiz3D, Geo-11, UEVR, ReShade,
VRto3D, dgVoodoo2, 3DGameBridge, etc.) are **fetched at setup time from their upstream GitHub releases**
via `scripts/download-tools.js` and never redistributed in source form. The `lib/` folder in the
source repository is **for development reference only** (so contributors can see the formats and
behaviours we adapt to) and is **not part of any redistributed Stereopticon binary**.

The `superdepth3d` tool entry is a **redirect** — at the author's (BlueSkyDefender) request,
Stereopticon points users to GPUSelector (BlueSkyDefender's own app) rather than installing
SuperDepth3D directly.

---

## Vireio Perception
**Original authors:** Andres Hernandez (2012), John Hicks, Neil Schneider, Chris Drain, Phil Larkson, Denis Reischl, Joshua Brown, Grant Bagwell, Simon Brown (2013–2015)
**License:** GNU Lesser General Public License v3.0 (LGPL v3)
**Source:** https://github.com/cybereality/Perception (modernisation fork: https://github.com/effcol/Vireio-Perception)

Stereopticon does **not** bundle Vireio Perception. Its source was carried in this repository up to
v0.0.1 and has since been moved out; Stereopticon only launches it as a separate program. The game
profile entries under `data/games/` were generated from Vireio's `profiles.xml`.

---

## Simulated Reality OpenTrack Bridge (bundled head-pose bridge — `engine/sr-opentrack-bridge/`)
**Authors:** evilkermitreturns & effcol (2026)
**License:** GNU General Public License v3.0 (same as parent project)
**Source:** Stereopticon project, `engine/sr-opentrack-bridge/`

C++ application that reads head pose from the LeiaSR Runtime (`SR::HeadPoseTracker`) and forwards 6-DOF data to OpenTrack via UDP on port 4242. Used automatically when a user selects an SR display + OpenTrack-based headtracking. Depends on LeiaSR Platform being installed on the user's machine (Stereopticon does not redistribute the LeiaSR SDK or Platform — those are vendor software the user installs separately).

---

## ReShade
**Copyright** © crosire and contributors  
**License:** BSD 2-Clause ("Simplified BSD License")  
**Source:** https://github.com/crosire/reshade  

ReShade is downloaded at build time by `scripts/download-reshade.js` and placed in
`resources/reshade/`. It is not modified. The BSD 2-Clause License is reproduced below:

> Redistribution and use in source and binary forms, with or without modification,
> are permitted provided that the following conditions are met:
> 1. Redistributions of source code must retain the above copyright notice, this
>    list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice,
>    this list of conditions and the following disclaimer in the documentation
>    and/or other materials provided with the distribution.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
> ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
> WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.

---

## 3DtoElse (including Frame Packing variant)
**Author:** Jose Negrete AKA BlueSkyDefender  
**Frame Packing extension:** NTM (3D Vision Discord community)  
**License:** Creative Commons Attribution 3.0 Unported (CC BY 3.0)  
**Source:** https://github.com/BlueSkyDefender/AstrayFX  
**CC BY 3.0:** https://creativecommons.org/licenses/by/3.0/us/  

3DtoElse.fx is bundled in `resources/reshade/shaders/3DtoElse.fx`.
The Frame Packing input mode was contributed by NTM via the 3D Vision Discord.
This file is used and distributed in accordance with CC BY 3.0 — attribution is given above.

---

## Anaglyph_to_SBS_or_TAB (universal) + game-specific variants
**Author:** Effie Colton  
**License:** GNU General Public License v3.0 (or later)  
**Repository:** https://github.com/effcol/Anaglyph-to-SBS-or-TAB  
**Upstream inspiration:** RetroArch/libretro `anaglyph-to-sbs.glsl` (https://github.com/libretro/glsl-shaders)

Universal ReShade shader converting anaglyph 3D to SBS, TAB, or other stereo formats.
Original ReShade port, UI, and extended features (multiple anaglyph schemes, intensity
blending, per-eye luma weights, aspect handling, Frame Packing) by Effie Colton, 2026.

---

## SuperDepth3D / GPUSelector
**Author:** Jose Negrete AKA BlueSkyDefender  
**License:** Creative Commons Attribution 3.0 Unported (CC BY 3.0)  
**App:** https://blueskydefender.github.io/GPUSelector  

Stereopticon does **not** bundle SuperDepth3D. Instead, it links users to GPUSelector,
BlueSkyDefender's own application, which manages SuperDepth3D installation and configuration
with per-game OverWatch profiles. This approach is used with the explicit permission of the
author and at their recommendation.

---

## 3DGameBridge
**Author:** 3DNovum  
**License:** MIT  
**Source:** https://github.com/3DNovum/3DGameBridge  

3DGameBridge shaders are downloaded at build time and placed in `resources/reshade/shaders/`.
They are not modified.

---

## ShaderGlass
**Author:** simonfs and contributors  
**License:** GNU General Public License v3.0  
**Source:** https://github.com/simonfs/ShaderGlass  

Stereopticon does not bundle ShaderGlass. It links users to the ShaderGlass GitHub
releases page for download. ShaderGlass is GPL v3, the same license as Stereopticon.

---

## Electron
**Copyright** © GitHub Inc.  
**License:** MIT  
**Source:** https://github.com/electron/electron  

---

## Node.js
**Copyright** © Node.js contributors  
**License:** MIT and various (see https://nodejs.org/en/about/trademark)

---

## UEVR
**Author:** praydog  
**License:** No license published for binaries at time of writing (see github.com/praydog/UEVR/issues/12)  
**Source:** https://github.com/praydog/UEVR  
**API headers only:** MIT (see `include/LICENSE`)

UEVRInjector.exe and UEVRBackend.dll are downloaded at setup time and not redistributed
in source form. The author is investigating GPL licensing pending legal clarification
around the Unreal Engine fork dependency. Stereopticon fetches these files directly
from the official GitHub releases for end-user convenience only.

The `include/` API headers are MIT licensed — Copyright © 2023 praydog.


---

## dgVoodoo2
**Author:** Dániel Domonkos (dege)  
**License:** See dgVoodoo2 documentation — free for personal use  
**Source:** https://github.com/dege-diosg/dgVoodoo2  

dgVoodoo2 DLLs are downloaded at setup time into `resources/dgvoodoo2/` and copied
per-game by the installer. They are not modified.


---

## VRto3D
**Author:** oneup03  
**License:** MIT  
**Source:** https://github.com/oneup03/VRto3D  

VRto3D is a SteamVR driver that renders stereoscopic 3D output from VR mods on flat 3D displays.
Downloaded at setup time and installed to SteamVR/drivers/vrto3d/. Not modified.


---
*This NOTICE file must be retained in all distributions of Stereopticon.*