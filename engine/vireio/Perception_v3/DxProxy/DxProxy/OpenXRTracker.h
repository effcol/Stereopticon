/********************************************************************
Vireio Perception v5 — OpenXR motion tracker.

Replaces the legacy OculusTracker.h (deleted in v3 → v5 modernization).
Sources head pose from any OpenXR-compatible runtime (SteamVR, Oculus
Link / Air Link, Monado, etc.) instead of the long-dead LibOVR 0.x/1.x
SDK that the original Vireio Perception used.

Phase 1.5: scaffolding + pose readout. Reports MTS_OK once an XR
session is in focus and view poses are predicted; otherwise reports
MTS_NOHMDDETECTED so the rest of the engine falls back to no tracking.

Licensed under LGPL-v3, same as the rest of v3/v5.
********************************************************************/
#pragma once
#ifndef OPENXRTRACKER_H_INCLUDED
#define OPENXRTRACKER_H_INCLUDED

#include "MotionTracker.h"
#include <cstdint>

// OpenXR handles are `uint64_t` on 32-bit and `pointer-to-T` on 64-bit —
// so a portable forward declaration isn't viable. Store handles as
// `uint64_t` here and reinterpret on the way into / out of the SDK calls
// in the .cpp. Keeps this header free of <openxr/openxr.h>.

class OpenXRTracker : public MotionTracker
{
public:
    OpenXRTracker();
    virtual ~OpenXRTracker();

    virtual void init() override;
    virtual void resetOrientationAndPosition() override;
    virtual int  getOrientationAndPosition(float* yaw, float* pitch, float* roll, float* x, float* y, float* z) override;
    virtual void updateOrientationAndPosition() override;
    virtual MotionTrackerStatus getStatus() override;
    virtual const char* GetTrackerDescription() override { return "OpenXR Head Tracker"; }
    virtual bool SupportsPositionTracking() override { return true; }

private:
    // XR runtime handles. Owned and lifecycle-managed by this tracker.
    // Stored as uint64_t because OpenXR's handle width is platform-dependent
    // (uint64_t on 32-bit, pointer on 64-bit). The .cpp reinterpret_casts
    // to the real XrInstance / XrSession / XrSpace types from the SDK.
    uint64_t m_instance       = 0;
    uint64_t m_session        = 0;
    uint64_t m_referenceSpace = 0;

    // Latest pose read from xrLocateViews — averaged across both eyes
    // to give one head-pose orientation for the engine's view-matrix
    // injection.
    float m_yaw   = 0.0f;
    float m_pitch = 0.0f;
    float m_roll  = 0.0f;
    float m_x     = 0.0f;
    float m_y     = 0.0f;
    float m_z     = 0.0f;

    // Recenter offsets — subtracted from the next pose read.
    float m_zeroYaw = 0.0f, m_zeroPitch = 0.0f, m_zeroRoll = 0.0f;
    float m_zeroX   = 0.0f, m_zeroY     = 0.0f, m_zeroZ   = 0.0f;

    MotionTrackerStatus m_status = MTS_NOTINIT;
};

#endif
