// opentrack_listener.cpp — receive FreeTrack 2.0 UDP packets, decode into HeadPose.
//
// OpenTrack's "freetrack-2.0" protocol packet is a fixed-format binary blob:
//   double  x, y, z;        // metres
//   double  yaw, pitch, roll;  // degrees
//   ...                     // additional fields we ignore
// The first 6 doubles (48 bytes) are what we need.
//
// We bind a non-blocking UDP socket on the configured port (default 4242)
// and spin a worker thread that recv()s into the lock-free HeadPose.
#include "vireio_ht.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <thread>
#include <atomic>
#include <cmath>

#pragma comment(lib, "ws2_32.lib")

namespace vireio_ht {

namespace {

std::atomic<bool>   g_running { false };
std::thread         g_thread;
SOCKET              g_socket  = INVALID_SOCKET;

constexpr float kDegToRad = 3.14159265358979323846f / 180.0f;

void worker() {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2,2), &wsa) != 0) return;

    g_socket = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (g_socket == INVALID_SOCKET) { WSACleanup(); return; }

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port        = htons(static_cast<u_short>(config().udp_port));
    if (::bind(g_socket, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
        closesocket(g_socket); g_socket = INVALID_SOCKET; WSACleanup(); return;
    }

    // 200ms recv timeout so we can poll g_running.
    DWORD timeoutMs = 200;
    setsockopt(g_socket, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));

    double buf[16];
    while (g_running.load(std::memory_order_acquire)) {
        int n = ::recv(g_socket, reinterpret_cast<char*>(buf), sizeof(buf), 0);
        if (n < static_cast<int>(sizeof(double) * 6)) continue;

        const auto& cfg = config();
        const float x   = static_cast<float>(buf[0]) * (cfg.invert_x ? -1.0f : 1.0f) * cfg.position_sensitivity;
        const float y   = static_cast<float>(buf[1]) * (cfg.invert_y ? -1.0f : 1.0f) * cfg.position_sensitivity;
        const float z   = static_cast<float>(buf[2]) * (cfg.invert_z ? -1.0f : 1.0f) * cfg.position_sensitivity;
        const float yaw   = static_cast<float>(buf[3]) * kDegToRad * (cfg.invert_yaw   ? -1.0f : 1.0f) * cfg.yaw_sensitivity;
        const float pitch = static_cast<float>(buf[4]) * kDegToRad * (cfg.invert_pitch ? -1.0f : 1.0f) * cfg.pitch_sensitivity;
        const float roll  = static_cast<float>(buf[5]) * kDegToRad * (cfg.invert_roll  ? -1.0f : 1.0f) * cfg.roll_sensitivity;

        // Per-axis deadzone (treat tiny angular noise as zero so the view
        // doesn't drift when the user's head is still).
        auto dz = [](float v, float deadzone_rad) {
            return (std::fabs(v) < deadzone_rad) ? 0.0f : v;
        };
        pose().yaw  .store(dz(yaw,   cfg.yaw_deadzone_deg   * kDegToRad), std::memory_order_relaxed);
        pose().pitch.store(dz(pitch, cfg.pitch_deadzone_deg * kDegToRad), std::memory_order_relaxed);
        pose().roll .store(roll, std::memory_order_relaxed);
        if (cfg.apply_position) {
            pose().x.store(x, std::memory_order_relaxed);
            pose().y.store(y, std::memory_order_relaxed);
            pose().z.store(z, std::memory_order_relaxed);
        }
        pose().active.store(true, std::memory_order_release);
    }

    closesocket(g_socket); g_socket = INVALID_SOCKET;
    WSACleanup();
}

}  // namespace

void start_opentrack_listener() {
    if (g_running.exchange(true)) return;
    g_thread = std::thread(worker);
}

void stop_opentrack_listener() {
    if (!g_running.exchange(false)) return;
    if (g_socket != INVALID_SOCKET) closesocket(g_socket);
    if (g_thread.joinable()) g_thread.join();
}

}  // namespace vireio_ht
