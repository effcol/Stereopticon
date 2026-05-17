/********************************************************************
Vireio Perception v5 — OpenTrack UDP head pose tracker.

OpenTrack the application emits the FreeTrack 2.0 protocol over UDP
(default port 4242). This tracker listens on that socket and decodes
each packet's pose (yaw / pitch / roll / x / y / z) into the engine's
shared HeadPose state.

Differs from FreeTrackTracker, which uses the legacy
FreeTrackClient.dll shared-memory IPC. OpenTrack UDP is the preferred
path in 2026: works over the network, no DLL dependency, easy to
chain through Stereopticon's OpenTrack hub on port 4242.

Licensed under LGPL-v3, same as the rest of v3/v5.
********************************************************************/
#pragma once
#ifndef OPENTRACKUDPTRACKER_H_INCLUDED
#define OPENTRACKUDPTRACKER_H_INCLUDED

#include "MotionTracker.h"
#include <atomic>
#include <thread>

class OpenTrackUDPTracker : public MotionTracker
{
public:
    OpenTrackUDPTracker();
    virtual ~OpenTrackUDPTracker();

    virtual void init() override;
    virtual void resetOrientationAndPosition() override;
    virtual int  getOrientationAndPosition(float* yaw, float* pitch, float* roll, float* x, float* y, float* z) override;
    virtual void updateOrientationAndPosition() override;
    virtual MotionTrackerStatus getStatus() override;
    virtual const char* GetTrackerDescription() override { return "OpenTrack UDP (FreeTrack 2.0 protocol)"; }
    virtual bool SupportsPositionTracking() override { return true; }

private:
    // Pose state — updated by the worker thread, read by the engine.
    // Atomic so we don't need a mutex on the hot read path.
    std::atomic<float> m_yaw   { 0.0f };
    std::atomic<float> m_pitch { 0.0f };
    std::atomic<float> m_roll  { 0.0f };
    std::atomic<float> m_x     { 0.0f };
    std::atomic<float> m_y     { 0.0f };
    std::atomic<float> m_z     { 0.0f };
    std::atomic<bool>  m_packetReceived { false };

    // Recenter offsets — subtracted on read.
    float m_zeroYaw = 0.0f, m_zeroPitch = 0.0f, m_zeroRoll = 0.0f;
    float m_zeroX   = 0.0f, m_zeroY     = 0.0f, m_zeroZ   = 0.0f;

    // Worker thread state.
    std::thread       m_workerThread;
    std::atomic<bool> m_running { false };
    int               m_socket  = -1;   // SOCKET handle as int — avoids leaking <winsock2.h> into the header.
    int               m_port    = 4242;

    MotionTrackerStatus m_status = MTS_NOTINIT;

    void WorkerLoop();   // background thread entry.
};

#endif
