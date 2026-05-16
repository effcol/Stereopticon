/********************************************************************
Vireio Perception: Open-Source Stereoscopic 3D Driver
Copyright (C) 2012 Andres Hernandez

OpenXR Direct Mode renderer plugin (v4.1 modernization, replaces the
outdated Oculus / OpenVR / OSVR direct-mode plugins with a single
cross-vendor implementation against the Khronos OpenXR standard).
File <OpenXR-DirectMode.h>:
Copyright (C) 2026 Vireio v4 modernization

Vireio Perception Version History:
v1.0.0 2012 by Andres Hernandez
v1.0.X 2013 by John Hicks, Neil Schneider
v1.1.x 2013 by Primary Coding Author: Chris Drain
Team Support: John Hicks, Phil Larkson, Neil Schneider
v2.0.x 2013 by Denis Reischl, Neil Schneider, Joshua Brown
v2.0.4 onwards 2014 by Grant Bagwell, Simon Brown and Neil Schneider
v4.0.x 2015 by Denis Reischl, Grant Bagwell, Simon Brown and Neil Schneider
v4.1.x 2026 modernization

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
#pragma once

#include <Windows.h>
#include <d3d11.h>
#pragma comment(lib, "d3d11.lib")

#define XR_USE_PLATFORM_WIN32
#define XR_USE_GRAPHICS_API_D3D11
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>
#pragma comment(lib, "openxr_loader.lib")

#include <vector>
#include <string>

#include "..\..\..\..\Aquilinus\Aquilinus\AQU_Nodus.h"
#include "..\..\..\Include\Vireio_Node_Plugtypes.h"

#define NUMBER_OF_OPENXR_COMMANDERS    11
#define NUMBER_OF_OPENXR_DECOMMANDERS    2
#define GUI_HEIGHT 160

/// <summary>
/// OpenXR Direct Mode output commanders. Mirrors the OpenVR-Tracker / FreeTrack
/// commander layout so existing game profiles can be redirected.
/// </summary>
enum class OpenXR_Commanders
{
    Pitch,
    Yaw,
    Roll,
    PositionX,
    PositionY,
    PositionZ,
    View,
    ProjectionLeft,
    ProjectionRight,
    TargetWidth,
    TargetHeight,
};

/// <summary>
/// OpenXR Direct Mode input decommanders. The plugin needs the eye-textures
/// from VireioCinema and an upstream D3D11 device handle.
/// </summary>
enum class OpenXR_Decommanders
{
    StereoData,         // VireioCinema's per-eye textures (StereoData* in Vireio_Node_Plugtypes.h)
    D3D11Device,        // ID3D11Device* used by the host game (so we can share textures)
};

/// <summary>
/// OpenXR Direct Mode renderer plugin. Submits VireioCinema's per-eye textures
/// to the active OpenXR runtime as a projection composition layer. Acts as both
/// a head-pose source (Pitch/Yaw/Roll/Position commanders) and an HMD output —
/// xrLocateViews drives the per-eye projection matrices each frame.
/// </summary>
class OpenXR_DirectMode : public AQU_Nodus
{
public:
    OpenXR_DirectMode(ImGuiContext* sCtx);
    virtual ~OpenXR_DirectMode();

    /*** AQU_Nodus public methods ***/
    virtual const char* GetNodeType()         override;
    virtual UINT32      GetNodeTypeId()       override;
    virtual LPCWSTR     GetCategory()         override;
    virtual HBITMAP     GetLogo()             override;
    virtual ImVec2      GetNodeSize()         override { return ImVec2((float)g_uGlobalNodeWidth, (float)GUI_HEIGHT); }
    virtual DWORD       GetCommandersNumber()   override { return NUMBER_OF_OPENXR_COMMANDERS; }
    virtual DWORD       GetDecommandersNumber() override { return NUMBER_OF_OPENXR_DECOMMANDERS; }
    virtual LPCWSTR     GetCommanderName(DWORD dwCommanderIndex)     override;
    virtual LPCWSTR     GetDecommanderName(DWORD dwDecommanderIndex) override;
    virtual DWORD       GetCommanderType(DWORD dwCommanderIndex)     override;
    virtual DWORD       GetDecommanderType(DWORD dwDecommanderIndex) override;
    virtual void*       GetOutputPointer(DWORD dwCommanderIndex)     override;
    virtual void        SetInputPointer(DWORD dwDecommanderIndex, void* pData) override;
    virtual bool        SupportsD3DMethod(int nD3DVersion, int nD3DInterface, int nD3DMethod) override;
    virtual void*       Provoke(void* pThis, int eD3D, int eD3DInterface, int eD3DMethod, DWORD dwNumberConnected, int& nProvokerIndex) override;
    virtual void        UpdateImGuiControl(float fZoom) override;

private:
    bool InitOpenXR(ID3D11Device* pcDevice);
    bool CreateSwapchains();
    void ShutdownOpenXR();
    void PollEvents();
    void RenderFrame();
    static void QuatToEuler(const XrQuaternionf& q, float& outPitch, float& outYaw, float& outRoll);
    static void BuildProjectionMatrix(const XrFovf& fov, float nearZ, float farZ, D3DMATRIX& outProj);
    static void BuildViewMatrix(const XrPosef& pose, D3DMATRIX& outView);

    XrInstance      m_xrInstance = XR_NULL_HANDLE;
    XrSystemId      m_xrSystemId = XR_NULL_SYSTEM_ID;
    XrSession       m_xrSession  = XR_NULL_HANDLE;
    XrSpace         m_xrAppSpace = XR_NULL_HANDLE;  // local/stage reference space
    XrSessionState  m_xrSessionState  = XR_SESSION_STATE_UNKNOWN;
    bool            m_xrSessionRunning = false;     // xrBeginSession called, not yet xrEndSession'd
    bool            m_xrInitFailed   = false;
    std::string     m_xrSystemName;
    std::string     m_xrLastError;

    // Per-eye recommended dimensions + sample count from XrViewConfigurationView.
    UINT32 m_aRecommendedWidth[2]  = { 0, 0 };
    UINT32 m_aRecommendedHeight[2] = { 0, 0 };
    UINT32 m_unRecommendedSampleCount = 1;

    // Swapchain state, one chain per eye.
    XrSwapchain                              m_axrSwapchains[2] = { XR_NULL_HANDLE, XR_NULL_HANDLE };
    int64_t                                  m_xrSwapchainFormat = 0;       // DXGI format we asked for
    std::vector<XrSwapchainImageD3D11KHR>    m_aSwapchainImages[2];
    bool                                     m_bSwapchainsReady = false;

    // [INPUT] from VireioCinema and host game.
    StereoData*           m_psStereoIn      = nullptr;
    ID3D11Device*         m_pcD3D11Device   = nullptr;
    ID3D11DeviceContext*  m_pcD3D11Context  = nullptr;   // immediate context, AddRef'd

    // Frame stats (informational).
    UINT64 m_unFramesSubmitted = 0;
    UINT64 m_unFramesSkipped   = 0;

    // [OUTPUT] head-pose values.
    float m_fPitch = 0.0f, m_fYaw = 0.0f, m_fRoll = 0.0f;
    float m_fX = 0.0f, m_fY = 0.0f, m_fZ = 0.0f;
    D3DMATRIX m_sView{}, m_sProj[2]{};
    UINT32 m_unTargetWidth = 0, m_unTargetHeight = 0;
};
