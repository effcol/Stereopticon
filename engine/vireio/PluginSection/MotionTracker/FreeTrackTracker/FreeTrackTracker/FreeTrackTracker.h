/********************************************************************
Vireio Perception: Open-Source Stereoscopic 3D Driver
Copyright (C) 2012 Andres Hernandez

FreeTrack tracker plugin (v4 port of v3's FreeTrackTracker class).
File <FreeTrackTracker.h> :
Copyright (C) 2012 Andres Hernandez (original v3 implementation)

Vireio Perception Version History:
v1.0.0 2012 by Andres Hernandez
v1.0.X 2013 by John Hicks, Neil Schneider
v1.1.x 2013 by Primary Coding Author: Chris Drain
Team Support: John Hicks, Phil Larkson, Neil Schneider
v2.0.x 2013 by Denis Reischl, Neil Schneider, Joshua Brown
v2.0.4 onwards 2014 by Grant Bagwell, Simon Brown and Neil Schneider
v4.0.x 2015 by Denis Reischl, Grant Bagwell, Simon Brown and Neil Schneider

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
#include <stdio.h>
#include <sstream>

#include "..\..\..\..\Aquilinus\Aquilinus\AQU_Nodus.h"
#include "..\..\..\Include\Vireio_Node_Plugtypes.h"

#define NUMBER_OF_COMMANDERS 7
#define GUI_HEIGHT 128

/// <summary>
/// FreeTrack data structure — matches FreeTrackClient.dll's exported FTData layout.
/// (The DLL itself is unchanged since 2008-ish; struct layout is frozen.)
/// </summary>
typedef struct _FTData
{
    unsigned long  dataID;
    long           camWidth;
    long           camHeight;
    float          yaw;
    float          pitch;
    float          roll;
    float          x;
    float          y;
    float          z;
    float          rawYaw;
    float          rawPitch;
    float          rawRoll;
    float          rawX;
    float          rawY;
    float          rawZ;
    float          x1, y1, x2, y2, x3, y3, x4, y4;
} FTData;

/// <summary>
/// FreeTrack DLL entry point signature.
/// </summary>
typedef bool (WINAPI *FT_GetData_t)(FTData* data);

/// <summary>
/// FreeTrack Tracker output commanders. Layout chosen to mirror OpenVR/OSVR
/// trackers so existing game profiles that wire a tracker's pitch/yaw/roll/X/Y/Z
/// to MatrixModifier can be redirected to this node trivially.
/// </summary>
enum FreeTrack_Commanders
{
    Pitch,
    Yaw,
    Roll,
    PositionX,
    PositionY,
    PositionZ,
    HMDTrackerOutput,   // aggregated HMDTrackerData* for Cinema/MatrixModifier consumers
};

/// <summary>
/// FreeTrack motion tracker node plugin.
/// Loads FreeTrackClient.dll lazily on first Provoke(), then polls FTGetData
/// each frame. Output is published both as individual yaw/pitch/roll/X/Y/Z
/// commanders and as an aggregated HMDTrackerData struct.
/// </summary>
class FreeTrackTracker : public AQU_Nodus
{
public:
    FreeTrackTracker(ImGuiContext* sCtx);
    virtual ~FreeTrackTracker();

    /*** AQU_Nodus public methods ***/
    virtual const char*  GetNodeType()        override;
    virtual UINT32       GetNodeTypeId()      override;
    virtual LPCWSTR      GetCategory()        override;
    virtual HBITMAP      GetLogo()            override;
    virtual ImVec2       GetNodeSize()        override { return ImVec2((float)g_uGlobalNodeWidth, (float)GUI_HEIGHT); }
    virtual DWORD        GetCommandersNumber() override { return NUMBER_OF_COMMANDERS; }
    virtual LPCWSTR      GetCommanderName(DWORD dwCommanderIndex)  override;
    virtual DWORD        GetCommanderType(DWORD dwCommanderIndex)  override;
    virtual void*        GetOutputPointer(DWORD dwCommanderIndex)  override;
    virtual bool         SupportsD3DMethod(int nD3DVersion, int nD3DInterface, int nD3DMethod) override;
    virtual void*        Provoke(void* pThis, int eD3D, int eD3DInterface, int eD3DMethod, DWORD dwNumberConnected, int& nProvokerIndex) override;
    virtual void         UpdateImGuiControl(float fZoom) override;

private:
    /// <summary>Try to load FreeTrackClient.dll once. Returns true on success.</summary>
    bool LoadFreeTrackLibrary();

    HMODULE        m_hFreeTrackDLL = nullptr;
    FT_GetData_t   m_pfnGetData   = nullptr;
    bool           m_bLoadAttempted = false;

    // Latest pose values, refreshed each Provoke().
    float          m_fYaw   = 0.0f;
    float          m_fPitch = 0.0f;
    float          m_fRoll  = 0.0f;
    float          m_fX     = 0.0f;
    float          m_fY     = 0.0f;
    float          m_fZ     = 0.0f;

    // Aggregated tracker output (consumed by Cinema, MatrixModifier).
    HMDTrackerData m_sTrackerData;
};
