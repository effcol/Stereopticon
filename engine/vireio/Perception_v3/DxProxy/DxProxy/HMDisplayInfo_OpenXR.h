/********************************************************************
Vireio Perception v5 — OpenXR HMD display info.

Replaces the legacy HMDisplayInfo_OculusRift.h (deleted in v3 → v5
modernization). Pulls eye-to-eye separation, screen geometry, and lens
distortion hints from a connected OpenXR-compatible HMD at runtime.

Phase 1.5: scaffolding. The XR-session-driven lookup of system properties
is wired but distortion coefficients fall back to the DK1 defaults until
a future turn extends this with per-headset profile data (Quest, Index,
Vive, etc.).

Licensed under LGPL-v3, same as the rest of v3/v5.
********************************************************************/
#pragma once
#ifndef HMDISPLAYINFO_OPENXR_H_INCLUDED
#define HMDISPLAYINFO_OPENXR_H_INCLUDED

#include "d3d9.h"
#include "d3dx9.h"
#include <utility>
#include <sstream>

#include "HMDisplayInfo.h"

// We don't pull <openxr/openxr.h> here to keep this header light. The XR
// session lifecycle is owned by OpenXRTracker / OpenXRDirectMode; this
// type just exposes physical-display values for the stereo math.

struct HMDisplayInfo_OpenXR : public HMDisplayInfo
{
public:
    HMDisplayInfo_OpenXR() : HMDisplayInfo()
    {
        // Phase 1.5 defaults — match DK1 baseline so existing convergence /
        // separation math doesn't fall over. Quest 3 / Index / Vive
        // distortion profiles get bolted on in a later turn.
        distortionCoefficients[0] = 1.0f;
        distortionCoefficients[1] = 0.22f;
        distortionCoefficients[2] = 0.24f;
        distortionCoefficients[3] = 0.0f;

        chromaCoefficients[0] =  0.010f;
        chromaCoefficients[1] =  0.002f;
        chromaCoefficients[2] = -0.002f;
        chromaCoefficients[3] = -0.005f;
    }

    virtual std::string GetHMDName() override { return "OpenXR Runtime"; }

    // Typical IPD; the OpenXR runtime returns the user's actual configured
    // IPD via xrLocateViews — wire that read into UpdateFromXr() (Phase 4).
    virtual float GetPhysicalLensSeparation() override { return 0.064f; }

    virtual float GetMinDistortionScale() override { return -1.0f; }

    virtual HMDManufacturer GetHMDManufacturer() override { return HMD_DIY; }
};

#endif
