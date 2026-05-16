# Simulated Reality OpenTrack Bridge

**A fork of Leia Track App focused on OpenTrack integration with full 6DOF head tracking support.**

Standalone head tracking for any OpenTrack-compatible game using a Leia Simulated Reality sparse lightfield display, such as Acer SpatialLabs and Samsung Odyssey 3D.

Reads head pose from the LeiaSR Runtime, applies a [One-Euro filter](https://gery.casiez.net/1euro/) for smooth adaptive filtering on yaw, pitch and roll, and sends stable 6DOF pose (position + orientation) as OpenTrack UDP to [OpenTrack](https://github.com/opentrack/opentrack).

## Games

### All VR / VR Modded Games

This bridge now works seamlessly with [VRto3D](https://github.com/oneup03/VRto3D) to add full 6DOF head tracking to **any VR game** and VR game mods (like [UEVR](https://github.com/praydog/UEVR)) running on your Leia/Immersity Simulated Reality displays.

**Requires:** [VRto3D](https://github.com/oneup03/VRto3D/releases) pre-release r486@f06b070 or later.

Simply follow [VRto3D's Simulated Relaity installation guide](https://github.com/oneup03/VRto3D?tab=readme-ov-file#sr-simulated-reality-displays-only-if-you-need-this-output-format) and start your favorite VR game or mod!. Your head movements are tracked in real-time with full 6DOF support.

### Stereoscopic 3D Games

Stereoscopic 3D games, modded or native, with OpenTrack head tracking support:

| Title | 3D support | OpenTrack Support |
|-------|------|-------|
| Assetto Corsa | [Geo-11](https://github.com/Stereoscopic3D/ShaderFixes/releases/tag/AssettoCorsa) | Native |
| Assetto Corsa Competizione | Acer TrueGame | Native |
| BeamNG.drive | [Geo-11](https://helixmod.blogspot.com/2023/11/beamngdrive.html) | Native |
| DCS World | [Geo-11](https://helixmod.blogspot.com/2018/02/dcs-25-3d-fix-wip.html) | Native |
| Descent | [OpenGL3DVision](https://helixmod.blogspot.com/2018/12/descent-1-2-dxx-rebirth-opengl.html) | Native |
| DiRT 3 | [SuperDepth3D](https://airtable.com/appByPZJsOQSVGDID/shrAfMuGs1IOIEpRT?uMgeK=rec4PbYHftnWBof6I) | Native |
| DiRT 4 | [3DMigoto/Geo-11](https://airtable.com/appByPZJsOQSVGDID/shrAfMuGs1IOIEpRT?uMgeK=recWWbkXb8lvYFiTd) | Native |
| Dirt Rally | [3DMigoto/Geo-11](https://airtable.com/appByPZJsOQSVGDID/shrAfMuGs1IOIEpRT?uMgeK=recyY9BtZKXOZihKA) | Native |
| Dirt Rally 2.0 | Acer TrueGame/[NewAxis](https://github.com/marcussacana/NewAxis) | Native |
| Dying Light 2 | [SuperDepth3D](https://airtable.com/appByPZJsOQSVGDID/shrAfMuGs1IOIEpRT?uMgeK=reci0NN7x8YDzjtch) | [Head Tracking Mod](https://www.nexusmods.com/dyinglight2/mods/1900) |
| Elite Dangerous | Native | Native |
| Euro Truck Simulator 2 | Acer TrueGame/[NewAxis](https://github.com/marcussacana/NewAxis) | Native |
| Gone Home | [VorpX](https://www.vorpx.com/) | [Head Tracking Mod](https://github.com/itsloopyo/gone-home-headtracking) |
| Green Hell | [Geo-11](https://helixmod.blogspot.com/2026/02/green-hell-geo11-fix.html) | [Head Tracking Mod](https://www.nexusmods.com/greenhell/mods/83) |
| MechWarrior 5: Mercenaries | [Geo-11](https://helixmod.blogspot.com/2020/01/mechwarrior-5-mercenaries.html) | Native |
| Microsoft Flight Simulator X | [SuperDepth3D](https://airtable.com/appByPZJsOQSVGDID/shrAfMuGs1IOIEpRT?uMgeK=rec1Aa5DLoRDwZ1FI) | Native |
| Minecraft: Java Edition | [Stereo 3D mod](https://modrinth.com/mod/stereopsis) | [Head Tracking Mod](https://www.curseforge.com/minecraft/mc-mods/correct-gaming-posture) |
| Overload | [Geo-11](https://helixmod.blogspot.com/2020/07/overload.html) | Native |
| Outer Wilds | [Geo-11](https://helixmod.blogspot.com/2019/07/outer-wilds-3d-vision-fix-losti-v100.html) | [Head Tracking Mod](https://outerwildsmods.com/mods/headtracking/) |
| Project CARS | [3DMigoto/Geo-11](https://airtable.com/appByPZJsOQSVGDID/shrAfMuGs1IOIEpRT?uMgeK=recmQ6ia16NkuIXgh) | Native |
| Project CARS 2 | [3DMigoto/Geo-11](https://airtable.com/appByPZJsOQSVGDID/shrAfMuGs1IOIEpRT?uMgeK=recmQGLLapAr8DZEp) | Native |
| Race Driver: GRID | [SuperDepth3D](https://airtable.com/appByPZJsOQSVGDID/shrAfMuGs1IOIEpRT?uMgeK=recXtcFbvdAtwEXuB) | Native |
| Star Wars: Squadrons | [Geo-11](https://helixmod.blogspot.com/2025/07/star-wars-squadrons-geo-11-fix-update.html) | Native |
| Subnautica | [Geo-11](https://helixmod.blogspot.com/2024/08/subnautica-final-version202371288.html) | [Head Tracking Mod](https://github.com/itsloopyo/subnautica-headtracking) |

*More games to be added as tested and released.*

**Recommended play modes:**
- **X, Y, Z, Yaw, Pitch** (Mode Z) — Best for most games, full 3-axis head tracking (position + yaw/pitch rotation) without roll
- **X, Y, Z only** (Mode X) — Pure positional tracking, matches the tracking on natively developed [LeiaSR SDK](https://support.immersity.ai/sdk/native-sdk-c-c++/index) games like The First Berserker: Khazan, Stellar Blade and Lies of P.

**by [evilkermitreturns](https://github.com/evilkermitreturns)** & [effcol](https://github.com/effcol)

## Requirements

- Leia Simulated Reality display (e.g. Acer SpatialLabs, Samsung Odyssey 3D)
- LeiaSR Runtime installed and running (installs via [SpatialLabs Experience  Centre](https://www.acer.com/gb-en/support/product-support/PSV27-2) or [Odyssey 3D Hub](https://www.samsung.com/levant/support/model/LS27FG900XMXUE/))
- [OpenTrack](https://github.com/opentrack/opentrack)
- [LeiaSR SDK](https://www.immersity.ai/sdk/) (for building from source)

## How to start

1. Run `Simulated_Reality_OpenTrack_Bridge.exe`
2. Launch OpenTrack
3. Set Input to UDP over network (should be on this by default)
4. Press Start in OpenTrack
5. Launch game or app of choice.
6. Look around naturally - no manual recenter needed.

## Controls

Hotkeys only work when the console window is focused. They won't interfere with your game.

### Tuning Hotkeys

| Key | Action |
|-----|--------|
| **Ctrl+L** | Lock/unlock tuning hotkeys |
| **1/2** | Yaw, Pitch, Roll smoothness (min_cutoff down/up) |
| **3/4** | Yaw, Pitch, Roll response speed (down/up) |
| **5/6** | Yaw sensitivity (down/up) |
| **7/8** | Pitch sensitivity (down/up) |
| **9/0** | Roll sensitivity (down/up) |
| **-/=** | Toggle translation passthrough |
| **[/]** | Toggle radians/degrees orientation input |

### Output Modes

Press one of these keys to switch output modes during gameplay. *Listed in order of recommendation*:

| Key | Mode | Description |
|-----|------|-------------|
| **Z** | X, Y, Z, Yaw, Pitch | **Recommended** — 6DOF Head Position and Head Rotation, no roll. Best for most games. |
| **X** | X, Y, Z | Head Position only, no Head Rotation.<br>*(This is how Leia uses Head Tracking in native games like Stellar Blade and Lies of P. Avoids [Motion Parallax Conflict](https://www.pcgamingwiki.com/wiki/Glossary:Native_3D#Motion_Parallax_Conflict).)* |
| **C** | Yaw, Pitch | 3DOF Head Rotation only, no roll. No position tracking. |
| **V** | X, Y, Z, Yaw, Pitch, Roll | Full 6DOF Head Position and Head Rotation including roll.<br>*(Not recommended as Roll is often unnecessary.)* |
| **B** | Yaw, Pitch, Roll | 3DOF Head Rotation only, no position.<br>*(Not recommended as Roll is often unnecessary.)* |

Settings auto-save on every change. Press **Ctrl+L** to lock hotkeys and prevent accidental changes.

### Output Target

| Key | Target | Filter | Description |
|-----|--------|--------|-------------|
| **A** | OpenTrack | One-Euro | Native OpenTrack UDP output (recommended for non-VR and most 3D games) |
| **S** | SteamVR/VRto3D | Simple Moving Average | Extra-smooth output for VRto3D/SteamVR (reduces jitter in VR mods) |

Switch output target at any time with A/S. Settings auto-save.

## Settings

Settings are saved to `opentrack_bridge_config.txt` (next to the executable) and auto-load on startup.

| Setting | Default | Description |
|---------|---------|-------------|
| `filter_rot_mincutoff` | 0.001 | Yaw, Pitch, Roll smoothness at rest. Very low = minimal noise (smoothest). Adjust for your display's IR noise. |
| `filter_rot_beta` | 0.001 | Yaw, Pitch, Roll responsiveness to fast movement. Higher = snappier response. |
| `filter_pos_mincutoff` | 0.08 | X, Y, Z position smoothness at rest. |
| `filter_pos_beta` | 0.08 | X, Y, Z position responsiveness to fast movement. |
| `angle_deadzone_deg` | 0.2 | Ignore tiny angle noise around center |
| `orientation_radians` | 1 | Set to 1 when SDK orientation output is radians |
| `sens_yaw` | 1.0 | Yaw output scale |
| `sens_pitch` | 1.0 | Pitch output scale |
| `sens_roll` | 1.0 | Roll output scale |
| `yaw_offset` | 0.0 | Yaw trim offset in degrees |
| `pitch_offset` | 0.0 | Pitch trim offset in degrees |
| `roll_offset` | 0.0 | Roll trim offset in degrees |
| `max_yaw` | 70 | Maximum yaw output (degrees) |
| `max_pitch` | 70 | Maximum pitch output (degrees) |
| `max_roll` | 70 | Maximum roll output (degrees) |
| `passthrough_translation` | 1 | Include position x, Y, Z in OpenTrack packet |
| `invert_x` | 1 | Invert X translation output (OpenTrack convention) |
| `invert_yaw` | 1 | Invert yaw output (OpenTrack convention) |
| `invert_roll` | 0 | Invert roll output. Set to 1 if head roll appears inverted (right roll = ground up). |
| `output_mode` | 1 | 1: X, Y, Z, Yaw, Pitch (default), 2: X, Y, Z, 3: Yaw, Pitch, 4: X, Y, Z, Yaw, Pitch, Roll (All 6DOF), 5: Yaw, Pitch, Roll (All 3DOF) |

### Editing the Config File

The config file is plain text — open it in any text editor. Default location:

```
C:\Users\[YourUsername]\[Path to executable folder]\opentrack_bridge_config.txt
```

Example contents:
```
# Simulated Reality OpenTrack Bridge — Settings
filter_rot_mincutoff = 0.001
filter_rot_beta = 0.001
filter_pos_mincutoff = 0.08
filter_pos_beta = 0.08
angle_deadzone_deg = 0.2
orientation_radians = 1
sens_yaw = 1
sens_pitch = 1
sens_roll = 1
yaw_offset = 0
pitch_offset = 0
roll_offset = 0
max_yaw = 70
max_pitch = 70
max_roll = 70
passthrough_translation = 1
invert_x = 1
invert_yaw = 1
invert_roll = 0
output_mode = 1
```

Lines starting with `#` are comments. Any setting not in the file uses its default value. Changes take effect next time you launch the app.

## Building from Source

Requires the LeiaSR SDK and CMake:

```bash
cd leia_track_app
mkdir build && cd build
cmake .. -DLEIASR_ROOT="path/to/simulatedreality-SDK"
cmake --build . --config Release
```

## How It Works

```
Leia IR Camera → SR SDK (head pose)
    → Orientation unit conversion (radians/degrees)
    → One-Euro filter (speed-adaptive smoothing)
    → Sensitivity + trim offsets
    → Clamp to max rotation
    → Optional translation passthrough
    → OpenTrack UDP (port 4242)
    → OpenTrack Software → Any Supported Game
```

## Tips

- **Centre monitor when launching** — When launching, I suggest looking and centreing yourself at the centre of your screen so the tracking initially correctly orientates you.
- **Good lighting helps** — the IR camera works best with some ambient light
- **Lock when playing** — press Ctrl+L to prevent accidental hotkey presses

## License

One-Euro Filter: BSD 3-Clause (Casiez/Roussel 2019)
Application: MIT
