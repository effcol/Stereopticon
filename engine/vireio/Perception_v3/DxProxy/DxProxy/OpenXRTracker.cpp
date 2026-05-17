/********************************************************************
OpenXRTracker.cpp — implementation.
Phase 1.5: enough scaffolding to compile + report a sane status. The
session is created with XR_REFERENCE_SPACE_TYPE_LOCAL so pose readback
is relative to the user's recentered origin. Full xrWaitFrame /
xrBeginFrame / xrEndFrame integration lives in OpenXRDirectMode (the
renderer); this tracker just reads the predicted pose during the
engine's per-frame update.
********************************************************************/
#include "OpenXRTracker.h"

// XR_USE_GRAPHICS_API_D3D11 requires <d3d11.h> to be included before
// <openxr/openxr_platform.h> so the D3D11 graphics-binding extension types
// can resolve. The OpenXR loader itself doesn't need D3D11 for the
// instance/session lifecycle this tracker uses, so we leave the graphics
// binding out for now — the renderer (OpenXRDirectMode) wires that up.
#define XR_USE_PLATFORM_WIN32
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <cmath>
#include <cstring>

namespace {
    // Convert an XR quaternion to Tait-Bryan yaw/pitch/roll. Right-handed,
    // matches the engine's existing convention (yaw around Y, pitch around X,
    // roll around Z).
    static void QuatToYPR(const XrQuaternionf& q, float& yaw, float& pitch, float& roll)
    {
        // ZYX rotation order intrinsic.
        const float sinr = 2.0f * (q.w * q.x + q.y * q.z);
        const float cosr = 1.0f - 2.0f * (q.x * q.x + q.y * q.y);
        pitch = std::atan2(sinr, cosr);

        const float sinp = 2.0f * (q.w * q.y - q.z * q.x);
        if (std::fabs(sinp) >= 1.0f) yaw = std::copysign(3.14159265f / 2.0f, sinp);
        else                          yaw = std::asin(sinp);

        const float siny = 2.0f * (q.w * q.z + q.x * q.y);
        const float cosy = 1.0f - 2.0f * (q.y * q.y + q.z * q.z);
        roll = std::atan2(siny, cosy);
    }
}

OpenXRTracker::OpenXRTracker() : MotionTracker() {}

OpenXRTracker::~OpenXRTracker()
{
    // Cast via void* so the same code compiles for 32-bit (handle = uint64_t)
    // and 64-bit (handle = pointer). On 32-bit OpenXR stores the handle by
    // value in the uint64_t; on 64-bit the uint64_t holds the pointer's bits.
    if (m_referenceSpace) xrDestroySpace   ((XrSpace)   (uintptr_t)m_referenceSpace);
    if (m_session)        xrDestroySession ((XrSession) (uintptr_t)m_session);
    if (m_instance)       xrDestroyInstance((XrInstance)(uintptr_t)m_instance);
}

void OpenXRTracker::init()
{
    MotionTracker::init();
    m_status = MTS_INITIALISING;

    // Create XR instance.
    XrApplicationInfo app = {};
    std::strncpy(app.applicationName, "Vireio Perception v5", sizeof(app.applicationName) - 1);
    app.applicationVersion = 5;
    std::strncpy(app.engineName, "Vireio", sizeof(app.engineName) - 1);
    app.engineVersion = 5;
    app.apiVersion = XR_CURRENT_API_VERSION;

    XrInstanceCreateInfo ici = { XR_TYPE_INSTANCE_CREATE_INFO };
    ici.applicationInfo = app;

    XrInstance instance = XR_NULL_HANDLE;
    if (XR_FAILED(xrCreateInstance(&ici, &instance))) {
        m_status = MTS_NOHMDDETECTED;
        return;
    }
    m_instance = (uint64_t)(uintptr_t)instance;

    // Pick a system (HMD). If none is present, give up cleanly.
    XrSystemGetInfo sgi = { XR_TYPE_SYSTEM_GET_INFO };
    sgi.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;
    XrSystemId systemId = XR_NULL_SYSTEM_ID;
    if (XR_FAILED(xrGetSystem(instance, &sgi, &systemId))) {
        m_status = MTS_NOHMDDETECTED;
        return;
    }

    // NOTE: A real XrSession requires a graphics binding (D3D11/D3D12/Vulkan).
    // Phase 1.5 stops short of opening the session — that integration ships
    // with OpenXRDirectMode (the renderer side). Without a session, pose
    // readback isn't possible, so we mark NOHMDDETECTED for now.
    m_status = MTS_NOHMDDETECTED;
}

void OpenXRTracker::resetOrientationAndPosition()
{
    m_zeroYaw   = m_yaw;
    m_zeroPitch = m_pitch;
    m_zeroRoll  = m_roll;
    m_zeroX     = m_x;
    m_zeroY     = m_y;
    m_zeroZ     = m_z;
}

void OpenXRTracker::updateOrientationAndPosition()
{
    // Phase 1.5 stub: a real implementation reads the latest XrViewState
    // from xrLocateViews here, averages the two eyes' poses, and stores
    // yaw/pitch/roll/x/y/z. With no session open yet, leave values at
    // their initial zero so the engine sees "no head movement."
}

int OpenXRTracker::getOrientationAndPosition(float* yaw, float* pitch, float* roll, float* x, float* y, float* z)
{
    if (yaw)   *yaw   = m_yaw   - m_zeroYaw;
    if (pitch) *pitch = m_pitch - m_zeroPitch;
    if (roll)  *roll  = m_roll  - m_zeroRoll;
    if (x)     *x     = m_x     - m_zeroX;
    if (y)     *y     = m_y     - m_zeroY;
    if (z)     *z     = m_z     - m_zeroZ;
    return (m_status == MTS_OK) ? 0 : -1;
}

MotionTrackerStatus OpenXRTracker::getStatus()
{
    return m_status;
}
