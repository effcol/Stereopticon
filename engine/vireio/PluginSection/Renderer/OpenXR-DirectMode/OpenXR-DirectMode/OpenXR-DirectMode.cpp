/********************************************************************
Vireio Perception: Open-Source Stereoscopic 3D Driver
Copyright (C) 2012 Andres Hernandez
File <OpenXR-DirectMode.cpp>:
Copyright (C) 2026 Vireio v4 modernization

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
********************************************************************/
#include "OpenXR-DirectMode.h"
#include <math.h>
#include <algorithm>
#include <dxgiformat.h>

OpenXR_DirectMode::OpenXR_DirectMode(ImGuiContext* sCtx) : AQU_Nodus(sCtx)
{
    // Identity-init the output matrices (consumers may read before InitOpenXR completes).
    m_sView    = { 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1 };
    m_sProj[0] = m_sView;
    m_sProj[1] = m_sView;
}

OpenXR_DirectMode::~OpenXR_DirectMode()
{
    ShutdownOpenXR();
}

const char* OpenXR_DirectMode::GetNodeType()   { return "OpenXR Direct Mode"; }
UINT32      OpenXR_DirectMode::GetNodeTypeId() { return (2026u << 16) + 801u; }
LPCWSTR     OpenXR_DirectMode::GetCategory()   { return L"Renderer"; }
HBITMAP     OpenXR_DirectMode::GetLogo()       { return nullptr; }

LPCWSTR OpenXR_DirectMode::GetCommanderName(DWORD dwCommanderIndex)
{
    switch ((OpenXR_Commanders)dwCommanderIndex)
    {
        case OpenXR_Commanders::Pitch:           return L"Pitch";
        case OpenXR_Commanders::Yaw:             return L"Yaw";
        case OpenXR_Commanders::Roll:            return L"Roll";
        case OpenXR_Commanders::PositionX:       return L"Position X";
        case OpenXR_Commanders::PositionY:       return L"Position Y";
        case OpenXR_Commanders::PositionZ:       return L"Position Z";
        case OpenXR_Commanders::View:            return L"View";
        case OpenXR_Commanders::ProjectionLeft:  return L"Projection Left";
        case OpenXR_Commanders::ProjectionRight: return L"Projection Right";
        case OpenXR_Commanders::TargetWidth:     return L"Target Width";
        case OpenXR_Commanders::TargetHeight:    return L"Target Height";
    }
    return L"";
}

LPCWSTR OpenXR_DirectMode::GetDecommanderName(DWORD dwDecommanderIndex)
{
    switch ((OpenXR_Decommanders)dwDecommanderIndex)
    {
        case OpenXR_Decommanders::StereoData:  return L"Stereo Data";
        case OpenXR_Decommanders::D3D11Device: return L"D3D11 Device";
    }
    return L"";
}

DWORD OpenXR_DirectMode::GetCommanderType(DWORD dwCommanderIndex)
{
    switch ((OpenXR_Commanders)dwCommanderIndex)
    {
        case OpenXR_Commanders::Pitch:
        case OpenXR_Commanders::Yaw:
        case OpenXR_Commanders::Roll:
        case OpenXR_Commanders::PositionX:
        case OpenXR_Commanders::PositionY:
        case OpenXR_Commanders::PositionZ:
            return NOD_Plugtype::AQU_FLOAT;
        case OpenXR_Commanders::View:
        case OpenXR_Commanders::ProjectionLeft:
        case OpenXR_Commanders::ProjectionRight:
            return NOD_Plugtype::AQU_D3DMATRIX;
        case OpenXR_Commanders::TargetWidth:
        case OpenXR_Commanders::TargetHeight:
            return NOD_Plugtype::AQU_UINT;
    }
    return 0;
}

DWORD OpenXR_DirectMode::GetDecommanderType(DWORD dwDecommanderIndex)
{
    switch ((OpenXR_Decommanders)dwDecommanderIndex)
    {
        case OpenXR_Decommanders::StereoData:  return VLink::Link(VLink::_L::StereoData);
        case OpenXR_Decommanders::D3D11Device: return NOD_Plugtype::AQU_HANDLE;
    }
    return 0;
}

void* OpenXR_DirectMode::GetOutputPointer(DWORD dwCommanderIndex)
{
    switch ((OpenXR_Commanders)dwCommanderIndex)
    {
        case OpenXR_Commanders::Pitch:           return &m_fPitch;
        case OpenXR_Commanders::Yaw:             return &m_fYaw;
        case OpenXR_Commanders::Roll:            return &m_fRoll;
        case OpenXR_Commanders::PositionX:       return &m_fX;
        case OpenXR_Commanders::PositionY:       return &m_fY;
        case OpenXR_Commanders::PositionZ:       return &m_fZ;
        case OpenXR_Commanders::View:            return &m_sView;
        case OpenXR_Commanders::ProjectionLeft:  return &m_sProj[0];
        case OpenXR_Commanders::ProjectionRight: return &m_sProj[1];
        case OpenXR_Commanders::TargetWidth:     return &m_unTargetWidth;
        case OpenXR_Commanders::TargetHeight:    return &m_unTargetHeight;
    }
    return nullptr;
}

void OpenXR_DirectMode::SetInputPointer(DWORD dwDecommanderIndex, void* pData)
{
    switch ((OpenXR_Decommanders)dwDecommanderIndex)
    {
        case OpenXR_Decommanders::StereoData:  m_psStereoIn    = reinterpret_cast<StereoData*>(pData); break;
        case OpenXR_Decommanders::D3D11Device: m_pcD3D11Device = *reinterpret_cast<ID3D11Device**>(pData); break;
    }
}

bool OpenXR_DirectMode::SupportsD3DMethod(int, int, int) { return true; }

void* OpenXR_DirectMode::Provoke(void* pThis, int, int, int, DWORD, int&)
{
    if (!m_xrInstance && !m_xrInitFailed)
    {
        InitOpenXR(m_pcD3D11Device);
    }
    if (m_xrInstance)
    {
        PollEvents();
        RenderFrame();
    }
    return pThis;
}

void OpenXR_DirectMode::UpdateImGuiControl(float /*fZoom*/)
{
    ImGui::Text("OpenXR Direct Mode");
    ImGui::Separator();
    if (m_xrInitFailed)
    {
        ImGui::TextColored(ImVec4(0.9f, 0.4f, 0.4f, 1.0f), "OpenXR init failed:");
        ImGui::TextWrapped("%s", m_xrLastError.c_str());
        return;
    }
    if (!m_xrInstance)
    {
        ImGui::Text("Waiting for D3D11 device input...");
        return;
    }
    ImGui::Text("System: %s", m_xrSystemName.empty() ? "(no name)" : m_xrSystemName.c_str());
    ImGui::Text("Render target: %ux%u per eye", m_aRecommendedWidth[0], m_aRecommendedHeight[0]);
    ImGui::Separator();
    ImGui::Text("Pose (deg): pitch=%+6.1f yaw=%+6.1f roll=%+6.1f", m_fPitch * 57.2958f, m_fYaw * 57.2958f, m_fRoll * 57.2958f);
    ImGui::Text("Position:   X=%+6.3f Y=%+6.3f Z=%+6.3f", m_fX, m_fY, m_fZ);
    ImGui::Separator();
    if (m_bSwapchainsReady)
        ImGui::TextColored(ImVec4(0.4f, 0.9f, 0.5f, 1.0f), "Frame submission active");
    else
        ImGui::TextColored(ImVec4(0.7f, 0.7f, 0.4f, 1.0f), "Waiting for session to enter SYNCHRONIZED");
    ImGui::Text("Frames: %llu submitted, %llu skipped", (unsigned long long)m_unFramesSubmitted, (unsigned long long)m_unFramesSkipped);
}

bool OpenXR_DirectMode::InitOpenXR(ID3D11Device* pcDevice)
{
    if (!pcDevice)
    {
        // Defer until a device is wired in.
        return false;
    }

    auto fail = [this](const char* msg) {
        m_xrLastError  = msg;
        m_xrInitFailed = true;
        ShutdownOpenXR();
        OutputDebugStringA("[OpenXR] init failed: ");
        OutputDebugStringA(msg);
        OutputDebugStringA("\n");
        return false;
    };

    // 1) Create XrInstance with D3D11 graphics binding extension.
    const char* requiredExts[] = { XR_KHR_D3D11_ENABLE_EXTENSION_NAME };
    XrInstanceCreateInfo createInfo{ XR_TYPE_INSTANCE_CREATE_INFO };
    strncpy_s(createInfo.applicationInfo.applicationName, "Vireio Perception", XR_MAX_APPLICATION_NAME_SIZE - 1);
    createInfo.applicationInfo.applicationVersion = 4;
    strncpy_s(createInfo.applicationInfo.engineName, "Aquilinus", XR_MAX_ENGINE_NAME_SIZE - 1);
    createInfo.applicationInfo.engineVersion = 4;
    createInfo.applicationInfo.apiVersion = XR_API_VERSION_1_0;
    createInfo.enabledExtensionCount = 1;
    createInfo.enabledExtensionNames = requiredExts;

    XrResult res = xrCreateInstance(&createInfo, &m_xrInstance);
    if (XR_FAILED(res))
        return fail("xrCreateInstance failed (is an OpenXR runtime installed?)");

    // 2) Get the head-mounted-display system.
    XrSystemGetInfo sysInfo{ XR_TYPE_SYSTEM_GET_INFO };
    sysInfo.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;
    res = xrGetSystem(m_xrInstance, &sysInfo, &m_xrSystemId);
    if (XR_FAILED(res))
        return fail("xrGetSystem failed (no HMD connected?)");

    XrSystemProperties sysProps{ XR_TYPE_SYSTEM_PROPERTIES };
    if (XR_SUCCEEDED(xrGetSystemProperties(m_xrInstance, m_xrSystemId, &sysProps)))
        m_xrSystemName = sysProps.systemName;

    // 3) Per-eye view configuration.
    uint32_t viewCount = 0;
    xrEnumerateViewConfigurationViews(m_xrInstance, m_xrSystemId, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO, 0, &viewCount, nullptr);
    std::vector<XrViewConfigurationView> views(viewCount, { XR_TYPE_VIEW_CONFIGURATION_VIEW });
    xrEnumerateViewConfigurationViews(m_xrInstance, m_xrSystemId, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO, viewCount, &viewCount, views.data());
    for (uint32_t i = 0; i < viewCount && i < 2; ++i)
    {
        m_aRecommendedWidth[i]  = views[i].recommendedImageRectWidth;
        m_aRecommendedHeight[i] = views[i].recommendedImageRectHeight;
    }
    m_unTargetWidth  = m_aRecommendedWidth[0];
    m_unTargetHeight = m_aRecommendedHeight[0];
    m_unRecommendedSampleCount = (viewCount > 0) ? views[0].recommendedSwapchainSampleCount : 1;

    // 4) Verify D3D11 graphics requirements (mandatory before xrCreateSession).
    PFN_xrGetD3D11GraphicsRequirementsKHR xrGetD3D11GraphicsRequirementsKHR = nullptr;
    res = xrGetInstanceProcAddr(m_xrInstance, "xrGetD3D11GraphicsRequirementsKHR", reinterpret_cast<PFN_xrVoidFunction*>(&xrGetD3D11GraphicsRequirementsKHR));
    if (XR_FAILED(res) || !xrGetD3D11GraphicsRequirementsKHR)
        return fail("xrGetD3D11GraphicsRequirementsKHR proc address not found");
    XrGraphicsRequirementsD3D11KHR gfxReq{ XR_TYPE_GRAPHICS_REQUIREMENTS_D3D11_KHR };
    res = xrGetD3D11GraphicsRequirementsKHR(m_xrInstance, m_xrSystemId, &gfxReq);
    if (XR_FAILED(res))
        return fail("xrGetD3D11GraphicsRequirementsKHR returned error");

    // 5) Create the XR session bound to the provided D3D11 device.
    XrGraphicsBindingD3D11KHR gfxBinding{ XR_TYPE_GRAPHICS_BINDING_D3D11_KHR };
    gfxBinding.device = pcDevice;
    XrSessionCreateInfo sessionCreate{ XR_TYPE_SESSION_CREATE_INFO };
    sessionCreate.next     = &gfxBinding;
    sessionCreate.systemId = m_xrSystemId;
    res = xrCreateSession(m_xrInstance, &sessionCreate, &m_xrSession);
    if (XR_FAILED(res))
        return fail("xrCreateSession failed");

    // 6) Create a local reference space (origin at recentered seated position).
    XrReferenceSpaceCreateInfo refSpaceCreate{ XR_TYPE_REFERENCE_SPACE_CREATE_INFO };
    refSpaceCreate.referenceSpaceType   = XR_REFERENCE_SPACE_TYPE_LOCAL;
    refSpaceCreate.poseInReferenceSpace = { {0,0,0,1}, {0,0,0} }; // identity quaternion, zero translation
    res = xrCreateReferenceSpace(m_xrSession, &refSpaceCreate, &m_xrAppSpace);
    if (XR_FAILED(res))
        return fail("xrCreateReferenceSpace failed");

    // 7) Cache the D3D11 immediate context — needed every frame for CopyResource
    //    from VireioCinema's eye textures into the swapchain images.
    pcDevice->GetImmediateContext(&m_pcD3D11Context);
    if (!m_pcD3D11Context)
        return fail("GetImmediateContext returned null");

    // 8) Build per-eye swapchains. We defer this on failure but treat the rest
    //    of the init as successful so the user still sees pose data.
    if (!CreateSwapchains())
        OutputDebugStringA("[OpenXR] Swapchain creation deferred or failed — pose-only fallback active\n");

    OutputDebugStringA("[OpenXR] Initialised successfully\n");
    return true;
}

bool OpenXR_DirectMode::CreateSwapchains()
{
    if (!m_xrSession || m_bSwapchainsReady) return m_bSwapchainsReady;

    // Pick a swapchain format the runtime supports. Preference order matches
    // what most desktop HMD runtimes (SteamVR / WMR / Quest Link) advertise.
    uint32_t fmtCount = 0;
    xrEnumerateSwapchainFormats(m_xrSession, 0, &fmtCount, nullptr);
    if (fmtCount == 0) return false;
    std::vector<int64_t> formats(fmtCount);
    xrEnumerateSwapchainFormats(m_xrSession, fmtCount, &fmtCount, formats.data());

    const int64_t preferred[] = {
        DXGI_FORMAT_R8G8B8A8_UNORM_SRGB,
        DXGI_FORMAT_B8G8R8A8_UNORM_SRGB,
        DXGI_FORMAT_R8G8B8A8_UNORM,
        DXGI_FORMAT_B8G8R8A8_UNORM,
    };
    m_xrSwapchainFormat = 0;
    for (int64_t want : preferred)
    {
        for (int64_t got : formats)
            if (want == got) { m_xrSwapchainFormat = want; break; }
        if (m_xrSwapchainFormat) break;
    }
    if (!m_xrSwapchainFormat)
        m_xrSwapchainFormat = formats[0];   // last-ditch fallback

    for (int eye = 0; eye < 2; ++eye)
    {
        XrSwapchainCreateInfo sci{ XR_TYPE_SWAPCHAIN_CREATE_INFO };
        sci.usageFlags  = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_TRANSFER_DST_BIT | XR_SWAPCHAIN_USAGE_SAMPLED_BIT;
        sci.format      = m_xrSwapchainFormat;
        sci.sampleCount = 1;                            // post-resolve, we only copy
        sci.width       = m_aRecommendedWidth[eye];
        sci.height      = m_aRecommendedHeight[eye];
        sci.faceCount   = 1;
        sci.arraySize   = 1;
        sci.mipCount    = 1;

        if (XR_FAILED(xrCreateSwapchain(m_xrSession, &sci, &m_axrSwapchains[eye])))
        {
            m_xrLastError = "xrCreateSwapchain failed";
            return false;
        }

        uint32_t imgCount = 0;
        xrEnumerateSwapchainImages(m_axrSwapchains[eye], 0, &imgCount, nullptr);
        m_aSwapchainImages[eye].assign(imgCount, { XR_TYPE_SWAPCHAIN_IMAGE_D3D11_KHR });
        xrEnumerateSwapchainImages(m_axrSwapchains[eye], imgCount, &imgCount,
            reinterpret_cast<XrSwapchainImageBaseHeader*>(m_aSwapchainImages[eye].data()));
    }

    m_bSwapchainsReady = true;
    OutputDebugStringA("[OpenXR] Swapchains ready\n");
    return true;
}

void OpenXR_DirectMode::ShutdownOpenXR()
{
    for (int eye = 0; eye < 2; ++eye)
    {
        if (m_axrSwapchains[eye]) { xrDestroySwapchain(m_axrSwapchains[eye]); m_axrSwapchains[eye] = XR_NULL_HANDLE; }
        m_aSwapchainImages[eye].clear();
    }
    m_bSwapchainsReady = false;

    if (m_xrSessionRunning && m_xrSession)
    {
        xrEndSession(m_xrSession);
        m_xrSessionRunning = false;
    }

    if (m_xrAppSpace) { xrDestroySpace(m_xrAppSpace);   m_xrAppSpace = XR_NULL_HANDLE; }
    if (m_xrSession)  { xrDestroySession(m_xrSession);  m_xrSession  = XR_NULL_HANDLE; }
    if (m_xrInstance) { xrDestroyInstance(m_xrInstance); m_xrInstance = XR_NULL_HANDLE; }
    m_xrSystemId = XR_NULL_SYSTEM_ID;

    if (m_pcD3D11Context) { m_pcD3D11Context->Release(); m_pcD3D11Context = nullptr; }
}

void OpenXR_DirectMode::PollEvents()
{
    if (!m_xrInstance) return;

    XrEventDataBuffer eventBuffer{ XR_TYPE_EVENT_DATA_BUFFER };
    while (xrPollEvent(m_xrInstance, &eventBuffer) == XR_SUCCESS)
    {
        if (eventBuffer.type == XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED)
        {
            const auto* st = reinterpret_cast<XrEventDataSessionStateChanged*>(&eventBuffer);
            m_xrSessionState = st->state;
            switch (st->state)
            {
                case XR_SESSION_STATE_READY:
                {
                    XrSessionBeginInfo bi{ XR_TYPE_SESSION_BEGIN_INFO };
                    bi.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
                    if (XR_SUCCEEDED(xrBeginSession(m_xrSession, &bi)))
                        m_xrSessionRunning = true;
                    break;
                }
                case XR_SESSION_STATE_STOPPING:
                {
                    if (m_xrSession) xrEndSession(m_xrSession);
                    m_xrSessionRunning = false;
                    break;
                }
                case XR_SESSION_STATE_EXITING:
                case XR_SESSION_STATE_LOSS_PENDING:
                {
                    m_xrSessionRunning = false;
                    break;
                }
                default: break;
            }
        }
        eventBuffer = { XR_TYPE_EVENT_DATA_BUFFER };
    }
}

void OpenXR_DirectMode::RenderFrame()
{
    if (!m_xrSession || !m_xrAppSpace) return;

    // The runtime only accepts xrWaitFrame/xrBeginFrame/xrEndFrame between
    // SYNCHRONIZED and STOPPING. Outside that window we silently skip frames
    // so the pose tracker still works during early startup / shutdown.
    if (!m_xrSessionRunning ||
        (m_xrSessionState != XR_SESSION_STATE_SYNCHRONIZED &&
         m_xrSessionState != XR_SESSION_STATE_VISIBLE &&
         m_xrSessionState != XR_SESSION_STATE_FOCUSED))
    {
        m_unFramesSkipped++;
        return;
    }

    // Lazy-create swapchains once the session is running — some runtimes only
    // accept xrCreateSwapchain after the session has been begun.
    if (!m_bSwapchainsReady && !CreateSwapchains())
    {
        m_unFramesSkipped++;
        return;
    }

    XrFrameWaitInfo  waitInfo{ XR_TYPE_FRAME_WAIT_INFO };
    XrFrameState     frameState{ XR_TYPE_FRAME_STATE };
    if (XR_FAILED(xrWaitFrame(m_xrSession, &waitInfo, &frameState)))
    {
        m_unFramesSkipped++;
        return;
    }

    XrFrameBeginInfo beginInfo{ XR_TYPE_FRAME_BEGIN_INFO };
    if (XR_FAILED(xrBeginFrame(m_xrSession, &beginInfo)))
    {
        m_unFramesSkipped++;
        return;
    }

    XrCompositionLayerProjectionView projViews[2] = {};
    XrCompositionLayerProjection     projLayer{ XR_TYPE_COMPOSITION_LAYER_PROJECTION };
    const XrCompositionLayerBaseHeader* layers[1] = { nullptr };
    uint32_t layerCount = 0;

    if (frameState.shouldRender == XR_TRUE)
    {
        // Locate the per-eye views at the predicted display time.
        XrView views[2] = { { XR_TYPE_VIEW }, { XR_TYPE_VIEW } };
        XrViewLocateInfo locInfo{ XR_TYPE_VIEW_LOCATE_INFO };
        locInfo.viewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
        locInfo.displayTime           = frameState.predictedDisplayTime;
        locInfo.space                 = m_xrAppSpace;
        XrViewState viewState{ XR_TYPE_VIEW_STATE };
        uint32_t viewCountOut = 0;
        const XrResult locRes = xrLocateViews(m_xrSession, &locInfo, &viewState, 2, &viewCountOut, views);

        const bool viewsValid = XR_SUCCEEDED(locRes) &&
            (viewState.viewStateFlags & XR_VIEW_STATE_ORIENTATION_VALID_BIT) &&
            (viewState.viewStateFlags & XR_VIEW_STATE_POSITION_VALID_BIT) &&
            viewCountOut >= 2;

        if (viewsValid)
        {
            // Publish the head pose (midpoint of the two eye poses).
            const XrPosef& pL = views[0].pose;
            const XrPosef& pR = views[1].pose;
            QuatToEuler(pL.orientation, m_fPitch, m_fYaw, m_fRoll);
            m_fX = 0.5f * (pL.position.x + pR.position.x);
            m_fY = 0.5f * (pL.position.y + pR.position.y);
            m_fZ = 0.5f * (pL.position.z + pR.position.z);

            // Publish per-eye projection + a (cyclops) view matrix.
            BuildViewMatrix(pL, m_sView);
            BuildProjectionMatrix(views[0].fov, 0.05f, 1000.0f, m_sProj[0]);
            BuildProjectionMatrix(views[1].fov, 0.05f, 1000.0f, m_sProj[1]);

            // Copy each eye's source texture into the runtime-provided swapchain image.
            for (int eye = 0; eye < 2 && m_pcD3D11Context; ++eye)
            {
                uint32_t imgIndex = 0;
                XrSwapchainImageAcquireInfo aqi{ XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO };
                if (XR_FAILED(xrAcquireSwapchainImage(m_axrSwapchains[eye], &aqi, &imgIndex)))
                    continue;
                XrSwapchainImageWaitInfo wi{ XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO };
                wi.timeout = XR_INFINITE_DURATION;
                if (XR_FAILED(xrWaitSwapchainImage(m_axrSwapchains[eye], &wi)))
                {
                    XrSwapchainImageReleaseInfo ri{ XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO };
                    xrReleaseSwapchainImage(m_axrSwapchains[eye], &ri);
                    continue;
                }

                ID3D11Texture2D* dstTex = m_aSwapchainImages[eye][imgIndex].texture;
                ID3D11Texture2D* srcTex = (m_psStereoIn ? m_psStereoIn->pcTex11[eye] : nullptr);
                if (dstTex && srcTex)
                {
                    // CopyResource requires matching dimensions+format. When they
                    // don't match exactly (common: source is window-sized, dest is
                    // runtime-recommended), fall back to CopySubresourceRegion
                    // bounded by the smaller of the two — letterboxes but never
                    // reads OOB. A proper scaler is a future TODO.
                    D3D11_TEXTURE2D_DESC sd{}; srcTex->GetDesc(&sd);
                    D3D11_TEXTURE2D_DESC dd{}; dstTex->GetDesc(&dd);
                    if (sd.Width == dd.Width && sd.Height == dd.Height && sd.Format == dd.Format)
                    {
                        m_pcD3D11Context->CopyResource(dstTex, srcTex);
                    }
                    else
                    {
                        D3D11_BOX box{};
                        box.right  = (std::min)(sd.Width,  dd.Width);
                        box.bottom = (std::min)(sd.Height, dd.Height);
                        box.back   = 1;
                        m_pcD3D11Context->CopySubresourceRegion(dstTex, 0, 0, 0, 0, srcTex, 0, &box);
                    }
                }

                XrSwapchainImageReleaseInfo ri{ XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO };
                xrReleaseSwapchainImage(m_axrSwapchains[eye], &ri);

                projViews[eye] = { XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW };
                projViews[eye].pose                       = views[eye].pose;
                projViews[eye].fov                        = views[eye].fov;
                projViews[eye].subImage.swapchain         = m_axrSwapchains[eye];
                projViews[eye].subImage.imageRect.offset  = { 0, 0 };
                projViews[eye].subImage.imageRect.extent  = { (int32_t)m_aRecommendedWidth[eye], (int32_t)m_aRecommendedHeight[eye] };
                projViews[eye].subImage.imageArrayIndex   = 0;
            }

            projLayer.space     = m_xrAppSpace;
            projLayer.viewCount = 2;
            projLayer.views     = projViews;
            layers[0]           = reinterpret_cast<XrCompositionLayerBaseHeader*>(&projLayer);
            layerCount          = 1;
        }
    }

    XrFrameEndInfo endInfo{ XR_TYPE_FRAME_END_INFO };
    endInfo.displayTime          = frameState.predictedDisplayTime;
    endInfo.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
    endInfo.layerCount           = layerCount;
    endInfo.layers               = layers;
    if (XR_SUCCEEDED(xrEndFrame(m_xrSession, &endInfo)))
        m_unFramesSubmitted++;
    else
        m_unFramesSkipped++;
}

void OpenXR_DirectMode::QuatToEuler(const XrQuaternionf& q, float& outPitch, float& outYaw, float& outRoll)
{
    // Standard quaternion-to-Euler (YXZ Tait-Bryan).
    const float sinp = 2.0f * (q.w * q.x - q.z * q.y);
    outPitch = (fabsf(sinp) >= 1.0f) ? copysignf(1.5707963f, sinp) : asinf(sinp);
    outYaw   = atan2f(2.0f * (q.w * q.y + q.x * q.z), 1.0f - 2.0f * (q.x * q.x + q.y * q.y));
    outRoll  = atan2f(2.0f * (q.w * q.z + q.x * q.y), 1.0f - 2.0f * (q.x * q.x + q.z * q.z));
}

/// Asymmetric off-axis projection from OpenXR FoV angles. DirectX-style
/// row-major D3DMATRIX with depth range [0,1] (NDC convention used by D3D11).
void OpenXR_DirectMode::BuildProjectionMatrix(const XrFovf& fov, float nearZ, float farZ, D3DMATRIX& m)
{
    const float l = tanf(fov.angleLeft);    // negative
    const float r = tanf(fov.angleRight);   // positive
    const float u = tanf(fov.angleUp);      // positive
    const float d = tanf(fov.angleDown);    // negative
    const float w = r - l;
    const float h = u - d;
    const float zRange = farZ - nearZ;

    for (int i = 0; i < 4; ++i) for (int j = 0; j < 4; ++j) m.m[i][j] = 0.0f;
    m.m[0][0] = 2.0f / w;
    m.m[1][1] = 2.0f / h;
    m.m[2][0] = (r + l) / w;
    m.m[2][1] = (u + d) / h;
    m.m[2][2] = -farZ / zRange;
    m.m[2][3] = -1.0f;
    m.m[3][2] = -(farZ * nearZ) / zRange;
}

/// View matrix = inverse of (translation * rotation) for the pose. Quaternion
/// to row-major rotation, then build the inverse rigid-body transform directly.
void OpenXR_DirectMode::BuildViewMatrix(const XrPosef& pose, D3DMATRIX& m)
{
    const float x = pose.orientation.x, y = pose.orientation.y, z = pose.orientation.z, w = pose.orientation.w;
    const float xx = x * x, yy = y * y, zz = z * z;
    const float xy = x * y, xz = x * z, yz = y * z;
    const float wx = w * x, wy = w * y, wz = w * z;

    // Forward rotation matrix R (row-major, row vectors).
    const float r00 = 1 - 2 * (yy + zz);
    const float r01 = 2 * (xy + wz);
    const float r02 = 2 * (xz - wy);
    const float r10 = 2 * (xy - wz);
    const float r11 = 1 - 2 * (xx + zz);
    const float r12 = 2 * (yz + wx);
    const float r20 = 2 * (xz + wy);
    const float r21 = 2 * (yz - wx);
    const float r22 = 1 - 2 * (xx + yy);

    // View = R^T (since R is orthonormal) with translation -R^T * pos.
    m.m[0][0] = r00;  m.m[0][1] = r10;  m.m[0][2] = r20;  m.m[0][3] = 0;
    m.m[1][0] = r01;  m.m[1][1] = r11;  m.m[1][2] = r21;  m.m[1][3] = 0;
    m.m[2][0] = r02;  m.m[2][1] = r12;  m.m[2][2] = r22;  m.m[2][3] = 0;
    m.m[3][0] = -(r00 * pose.position.x + r01 * pose.position.y + r02 * pose.position.z);
    m.m[3][1] = -(r10 * pose.position.x + r11 * pose.position.y + r12 * pose.position.z);
    m.m[3][2] = -(r20 * pose.position.x + r21 * pose.position.y + r22 * pose.position.z);
    m.m[3][3] = 1;
}

/**
 * Exported constructor — Aquilinus loads the plugin DLL and calls this.
 */
extern "C" __declspec(dllexport) AQU_Nodus* AQU_Nodus_Create(ImGuiContext* sCtx)
{
    return static_cast<AQU_Nodus*>(new OpenXR_DirectMode(sCtx));
}
