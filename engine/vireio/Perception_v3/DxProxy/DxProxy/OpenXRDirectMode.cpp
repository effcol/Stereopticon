/********************************************************************
OpenXRDirectMode.cpp — Phase 1.5 implementation.

Owns the OpenXR instance/session/space that will, in a future turn,
present the v5 engine's stereo backbuffer to the HMD via composition
layers. For now this class behaves identically to its base StereoView
(flat SBS output) so the rest of the engine compiles cleanly with the
OCULUS_DIRECT_MODE switch case routed here.

Wiring the actual XR frame submission requires a D3D11 binding (XR
runtimes don't accept D3D9). The v5 plan adds a small D3D9→D3D11 shared-
texture bridge in the StereoView's PostPresent path; that lands in the
next sprint.
********************************************************************/
#include "OpenXRDirectMode.h"

// XR_USE_GRAPHICS_API_D3D11 requires <d3d11.h> before <openxr_platform.h>
// because that header declares XrGraphicsBindingD3D11KHR which references
// D3D11 types. Pull D3D11 in first.
#define XR_USE_PLATFORM_WIN32
#define XR_USE_GRAPHICS_API_D3D11
#include <d3d11.h>
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

OpenXRDirectMode::OpenXRDirectMode(ProxyConfig* config,
                                   HMDisplayInfo* hmd,
                                   MotionTracker* tracker)
    : StereoView(config), m_hmd(hmd), m_tracker(tracker)
{
    // Phase 1.5: instance + system lookup happen lazily on first Init()
    // (when we know the D3D11 device to bind into the XrSession). Keeping
    // the constructor side-effect-free matches the StereoView contract.
}

OpenXRDirectMode::~OpenXRDirectMode()
{
    // Cast via uintptr_t — works for 32-bit (handle stored as 64-bit value)
    // and 64-bit (handle stored as pointer bits).
    if (m_appSpace)  xrDestroySpace   ((XrSpace)   (uintptr_t)m_appSpace);
    if (m_session)   xrDestroySession ((XrSession) (uintptr_t)m_session);
    if (m_instance)  xrDestroyInstance((XrInstance)(uintptr_t)m_instance);
}
