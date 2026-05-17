/********************************************************************
Vireio Perception v5 — OpenXR direct-mode HMD renderer.

Replaces the legacy OculusDirectToRiftView.h (deleted in v3 → v5
modernization). Owns the OpenXR session lifecycle, drives xrWaitFrame /
xrBeginFrame / xrEndFrame for the host game's render thread, and
submits the stereo backbuffer (the same one StereoView already produces
for SBS/TAB output) into the XR composition layer.

Phase 1.5: scaffolding. Inherits StereoView so the OCULUS_DIRECT_MODE
factory case can return one without changing call sites. Real
xrCreateSession / xrLocateViews / xrEndFrame plumbing comes in the next
turn — for now this is a no-op pass-through to the base StereoView,
which means HMD users see flat side-by-side output until the renderer
is wired through.

Licensed under LGPL-v3, same as the rest of v3/v5.
********************************************************************/
#pragma once
#ifndef OPENXRDIRECTMODE_H_INCLUDED
#define OPENXRDIRECTMODE_H_INCLUDED

#include "StereoView.h"
#include <cstdint>

// OpenXR handles are platform-dependent in width — store as uint64_t and
// reinterpret_cast inside the .cpp where the SDK headers are included.
class HMDisplayInfo;
class MotionTracker;

class OpenXRDirectMode : public StereoView
{
public:
    OpenXRDirectMode(ProxyConfig* config,
                     HMDisplayInfo* hmd,
                     MotionTracker* tracker);
    virtual ~OpenXRDirectMode();

    // Phase 1.5: inherits all StereoView behaviour. The actual frame-submit
    // overrides land in the next turn. Listed here so the .cpp can grow into
    // them without further header churn.
    // virtual void Init(IDirect3DDevice9* pActualDevice) override;
    // virtual void PostPresent(D3D9ProxySurface* leftSurface, D3D9ProxySurface* rightSurface) override;
    // virtual void Reset() override;
    // virtual void ReleaseEverything() override;

private:
    HMDisplayInfo* m_hmd = nullptr;
    MotionTracker* m_tracker = nullptr;
    uint64_t m_instance = 0;   // XrInstance — reinterpret in .cpp
    uint64_t m_session  = 0;   // XrSession
    uint64_t m_appSpace = 0;   // XrSpace
};

#endif
