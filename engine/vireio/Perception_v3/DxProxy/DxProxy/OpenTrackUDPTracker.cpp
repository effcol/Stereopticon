/********************************************************************
OpenTrackUDPTracker.cpp — UDP listener for OpenTrack's FreeTrack 2.0
output. Spins one worker thread that recv()s on port 4242 and decodes
the first 6 doubles of each packet into the engine's head pose state.

Packet shape (FreeTrack 2.0 / OpenTrack `freetrack-2.0` output):
    double  x, y, z;        // metres
    double  yaw, pitch, roll; // degrees
    ...                     // optional additional fields
We need only the leading 48 bytes; OpenTrack pads the rest. Note the
field ORDER here matches OpenTrack's `freetrack-2.0` output spec:
position first, then orientation.

Licensed under LGPL-v3, same as the rest of v3/v5.
********************************************************************/
// winsock2.h MUST come before any header that transitively includes
// <windows.h> (which pulls in the legacy winsock.h v1 — incompatible with
// winsock2 — unless WIN32_LEAN_AND_MEAN is defined first). Putting our
// own header below the network includes gives the cleanest fix without
// touching MotionTracker.h's include order.
#include <winsock2.h>
#include <ws2tcpip.h>

#include "OpenTrackUDPTracker.h"

#include <chrono>
#include <cmath>

#pragma comment(lib, "ws2_32.lib")

namespace {
    static const float kDegToRad = 0.01745329251994329577f;
}

OpenTrackUDPTracker::OpenTrackUDPTracker() : MotionTracker() {}

OpenTrackUDPTracker::~OpenTrackUDPTracker()
{
    m_running.store(false);
    if (m_socket != -1) {
        ::closesocket(static_cast<SOCKET>(m_socket));
        m_socket = -1;
    }
    if (m_workerThread.joinable()) m_workerThread.join();
    // Best-effort WSACleanup balanced against init.
    ::WSACleanup();
}

void OpenTrackUDPTracker::init()
{
    MotionTracker::init();
    m_status = MTS_INITIALISING;

    WSADATA wsa = {};
    if (::WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        m_status = MTS_INITFAIL;
        return;
    }

    SOCKET s = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s == INVALID_SOCKET) { m_status = MTS_INITFAIL; ::WSACleanup(); return; }

    // Make the socket non-blocking so the worker thread can poll-shutdown
    // cleanly when m_running flips false.
    u_long nonblock = 1;
    ::ioctlsocket(s, FIONBIO, &nonblock);

    sockaddr_in addr = {};
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port        = htons(static_cast<u_short>(m_port));
    if (::bind(s, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
        ::closesocket(s);
        ::WSACleanup();
        m_status = MTS_INITFAIL;
        return;
    }

    m_socket = static_cast<int>(s);
    m_running.store(true);
    m_workerThread = std::thread(&OpenTrackUDPTracker::WorkerLoop, this);

    // Status flips to OK once we've received at least one packet — see WorkerLoop.
    m_status = MTS_NOORIENTATION;
}

void OpenTrackUDPTracker::WorkerLoop()
{
    // OpenTrack emits ~250 Hz; we sleep ~2 ms between non-blocking recv attempts.
    while (m_running.load()) {
        if (m_socket == -1) break;
        double buf[6] = { 0 };   // x, y, z, yaw, pitch, roll
        sockaddr_in from = {};
        int fromLen = sizeof(from);
        int n = ::recvfrom(static_cast<SOCKET>(m_socket),
                           reinterpret_cast<char*>(buf), sizeof(buf), 0,
                           reinterpret_cast<sockaddr*>(&from), &fromLen);
        if (n >= static_cast<int>(sizeof(buf))) {
            // OpenTrack `freetrack-2.0`: x/y/z in metres, then yaw/pitch/roll in
            // degrees. Convert orientation to radians; positions pass through.
            m_x    .store(static_cast<float>(buf[0]));
            m_y    .store(static_cast<float>(buf[1]));
            m_z    .store(static_cast<float>(buf[2]));
            m_yaw  .store(static_cast<float>(buf[3]) * kDegToRad);
            m_pitch.store(static_cast<float>(buf[4]) * kDegToRad);
            m_roll .store(static_cast<float>(buf[5]) * kDegToRad);
            m_packetReceived.store(true);
            m_status = MTS_OK;
        } else if (n == SOCKET_ERROR) {
            const int err = ::WSAGetLastError();
            if (err != WSAEWOULDBLOCK && err != WSAEINTR) {
                // Real socket failure — give up the loop.
                m_status = MTS_DRIVERFAIL;
                break;
            }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
}

void OpenTrackUDPTracker::updateOrientationAndPosition()
{
    // No-op — the worker thread does the heavy lifting and pose values
    // are pulled live in getOrientationAndPosition.
}

void OpenTrackUDPTracker::resetOrientationAndPosition()
{
    m_zeroYaw   = m_yaw  .load();
    m_zeroPitch = m_pitch.load();
    m_zeroRoll  = m_roll .load();
    m_zeroX     = m_x    .load();
    m_zeroY     = m_y    .load();
    m_zeroZ     = m_z    .load();
}

int OpenTrackUDPTracker::getOrientationAndPosition(float* yaw, float* pitch, float* roll, float* x, float* y, float* z)
{
    if (yaw)   *yaw   = m_yaw  .load() - m_zeroYaw;
    if (pitch) *pitch = m_pitch.load() - m_zeroPitch;
    if (roll)  *roll  = m_roll .load() - m_zeroRoll;
    if (x)     *x     = m_x    .load() - m_zeroX;
    if (y)     *y     = m_y    .load() - m_zeroY;
    if (z)     *z     = m_z    .load() - m_zeroZ;
    return (m_status == MTS_OK) ? 0 : -1;
}

MotionTrackerStatus OpenTrackUDPTracker::getStatus()
{
    return m_status;
}
