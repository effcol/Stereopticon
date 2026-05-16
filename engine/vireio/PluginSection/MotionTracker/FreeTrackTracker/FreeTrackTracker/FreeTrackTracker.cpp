/********************************************************************
Vireio Perception: Open-Source Stereoscopic 3D Driver
Copyright (C) 2012 Andres Hernandez

FreeTrack tracker plugin (v4 port of v3's FreeTrackTracker class).
File <FreeTrackTracker.cpp> :
Copyright (C) 2012 Andres Hernandez (original v3 implementation)

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
#include "FreeTrackTracker.h"

FreeTrackTracker::FreeTrackTracker(ImGuiContext* sCtx) : AQU_Nodus(sCtx)
{
    memset(&m_sTrackerData, 0, sizeof(m_sTrackerData));

    // Identity matrices for sProj[2] and sView. FreeTrack provides no HMD optics,
    // so downstream Cinema falls back to its default projection.
    m_sTrackerData.sProj[0]._11 = m_sTrackerData.sProj[0]._22 = m_sTrackerData.sProj[0]._33 = m_sTrackerData.sProj[0]._44 = 1.0f;
    m_sTrackerData.sProj[1]._11 = m_sTrackerData.sProj[1]._22 = m_sTrackerData.sProj[1]._33 = m_sTrackerData.sProj[1]._44 = 1.0f;
    m_sTrackerData.sView._11    = m_sTrackerData.sView._22    = m_sTrackerData.sView._33    = m_sTrackerData.sView._44    = 1.0f;

    m_sTrackerData.sTx.fW = 1920;
    m_sTrackerData.sTx.fH = 1080;
}

FreeTrackTracker::~FreeTrackTracker()
{
    if (m_hFreeTrackDLL)
    {
        FreeLibrary(m_hFreeTrackDLL);
        m_hFreeTrackDLL = nullptr;
        m_pfnGetData    = nullptr;
    }
}

const char* FreeTrackTracker::GetNodeType()
{
    return "FreeTrack Tracker";
}

UINT32 FreeTrackTracker::GetNodeTypeId()
{
    // Vireio node-id convention: (DEVELOPER_IDENTIFIER << 16) + PLUGIN_IDENTIFIER.
    // Developer 2026 (modernization batch), plugin 800 (FreeTrack family).
    return (2026u << 16) + 800u;
}

LPCWSTR FreeTrackTracker::GetCategory()
{
    return L"Motion Tracker";
}

HBITMAP FreeTrackTracker::GetLogo()
{
    return nullptr;
}

LPCWSTR FreeTrackTracker::GetCommanderName(DWORD dwCommanderIndex)
{
    switch ((FreeTrack_Commanders)dwCommanderIndex)
    {
        case FreeTrack_Commanders::Pitch:            return L"Pitch";
        case FreeTrack_Commanders::Yaw:              return L"Yaw";
        case FreeTrack_Commanders::Roll:             return L"Roll";
        case FreeTrack_Commanders::PositionX:        return L"Position X";
        case FreeTrack_Commanders::PositionY:        return L"Position Y";
        case FreeTrack_Commanders::PositionZ:        return L"Position Z";
        case FreeTrack_Commanders::HMDTrackerOutput: return L"Tracker Data";
    }
    return L"";
}

DWORD FreeTrackTracker::GetCommanderType(DWORD dwCommanderIndex)
{
    switch ((FreeTrack_Commanders)dwCommanderIndex)
    {
        case FreeTrack_Commanders::Pitch:
        case FreeTrack_Commanders::Yaw:
        case FreeTrack_Commanders::Roll:
        case FreeTrack_Commanders::PositionX:
        case FreeTrack_Commanders::PositionY:
        case FreeTrack_Commanders::PositionZ:
            return NOD_Plugtype::AQU_FLOAT;
        case FreeTrack_Commanders::HMDTrackerOutput:
            // Aggregated tracker data shared with Cinema / MatrixModifier.
            return VLink::Link(VLink::_L::TrackerData);
    }
    return 0;
}

void* FreeTrackTracker::GetOutputPointer(DWORD dwCommanderIndex)
{
    switch ((FreeTrack_Commanders)dwCommanderIndex)
    {
        case FreeTrack_Commanders::Pitch:            return (void*)&m_fPitch;
        case FreeTrack_Commanders::Yaw:              return (void*)&m_fYaw;
        case FreeTrack_Commanders::Roll:             return (void*)&m_fRoll;
        case FreeTrack_Commanders::PositionX:        return (void*)&m_fX;
        case FreeTrack_Commanders::PositionY:        return (void*)&m_fY;
        case FreeTrack_Commanders::PositionZ:        return (void*)&m_fZ;
        case FreeTrack_Commanders::HMDTrackerOutput: return (void*)&m_sTrackerData;
    }
    return nullptr;
}

bool FreeTrackTracker::SupportsD3DMethod(int /*nD3DVersion*/, int /*nD3DInterface*/, int /*nD3DMethod*/)
{
    // FreeTrack is independent of the rendering API — poll on every provoke.
    return true;
}

void* FreeTrackTracker::Provoke(void* pThis, int /*eD3D*/, int /*eD3DInterface*/, int /*eD3DMethod*/, DWORD /*dwNumberConnected*/, int& /*nProvokerIndex*/)
{
    if (!m_bLoadAttempted)
    {
        LoadFreeTrackLibrary();
        m_bLoadAttempted = true;
    }
    if (!m_pfnGetData)
        return pThis;

    FTData data = {};
    if (m_pfnGetData(&data))
    {
        m_fYaw   = data.yaw;
        m_fPitch = data.pitch;
        m_fRoll  = data.roll;
        m_fX     = data.x;
        m_fY     = data.y;
        m_fZ     = data.z;

        m_sTrackerData.sEu.fYaw   = m_fYaw;
        m_sTrackerData.sEu.fPitch = m_fPitch;
        m_sTrackerData.sEu.fRoll  = m_fRoll;
        m_sTrackerData.sPo.fX     = m_fX;
        m_sTrackerData.sPo.fY     = m_fY;
        m_sTrackerData.sPo.fZ     = m_fZ;
    }
    return pThis;
}

void FreeTrackTracker::UpdateImGuiControl(float /*fZoom*/)
{
    // Tiny status panel inside the node — readout of current pose values.
    ImGui::Text("FreeTrack");
    ImGui::Separator();
    if (!m_pfnGetData)
    {
        ImGui::TextColored(ImVec4(0.9f, 0.4f, 0.4f, 1.0f), "FreeTrackClient.dll not loaded");
        return;
    }
    ImGui::Text("Yaw:   %+7.2f", m_fYaw);
    ImGui::Text("Pitch: %+7.2f", m_fPitch);
    ImGui::Text("Roll:  %+7.2f", m_fRoll);
    ImGui::Text("X:     %+7.3f", m_fX);
    ImGui::Text("Y:     %+7.3f", m_fY);
    ImGui::Text("Z:     %+7.3f", m_fZ);
}

bool FreeTrackTracker::LoadFreeTrackLibrary()
{
    // Try plugin-local copy first (Release/Perception/bin/x64/plugin/FreeTrackClient.dll),
    // then the system search path. FreeTrack-protocol-compatible alternatives like
    // OpenTrack also drop a FreeTrackClient.dll for redirection.
    m_hFreeTrackDLL = LoadLibraryW(L"FreeTrackClient.dll");
    if (!m_hFreeTrackDLL)
    {
        OutputDebugStringW(L"[FreeTrack] FreeTrackClient.dll not found in module search path");
        return false;
    }

    m_pfnGetData = reinterpret_cast<FT_GetData_t>(GetProcAddress(m_hFreeTrackDLL, "FTGetData"));
    if (!m_pfnGetData)
    {
        OutputDebugStringW(L"[FreeTrack] FTGetData export missing from FreeTrackClient.dll");
        FreeLibrary(m_hFreeTrackDLL);
        m_hFreeTrackDLL = nullptr;
        return false;
    }

    OutputDebugStringW(L"[FreeTrack] FreeTrackClient.dll loaded successfully");
    return true;
}

/**
 * Exported constructor — Aquilinus loads the plugin DLL and calls this to
 * instantiate the node.
 */
extern "C" __declspec(dllexport) AQU_Nodus* AQU_Nodus_Create(ImGuiContext* sCtx)
{
    return static_cast<AQU_Nodus*>(new FreeTrackTracker(sCtx));
}
