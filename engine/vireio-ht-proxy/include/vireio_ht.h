// vireio_ht.h — shared headers for the head-tracking proxy DLL.
#pragma once

#include <windows.h>
#include <d3d9.h>
#include <atomic>

namespace vireio_ht {

// Current head pose, lock-free. Updated by the UDP listener thread,
// read by the D3D proxy's SetTransform interceptor. atomic<float> on
// x86/x64 is naturally aligned and wait-free, so no mutex needed.
struct HeadPose {
    std::atomic<float> yaw   { 0.0f };    // radians
    std::atomic<float> pitch { 0.0f };
    std::atomic<float> roll  { 0.0f };
    std::atomic<float> x     { 0.0f };    // metres (forward/back/lean)
    std::atomic<float> y     { 0.0f };
    std::atomic<float> z     { 0.0f };
    std::atomic<bool>  active{ false };   // true once we've received a packet
};

// Singleton accessor — defined in main.cpp.
HeadPose& pose();

// Config (loaded from vireio-ht.ini if present, defaults otherwise).
struct Config {
    int   udp_port            = 4242;
    bool  invert_yaw          = false;
    bool  invert_pitch        = false;
    bool  invert_roll         = false;
    bool  invert_x            = false;
    bool  invert_y            = false;
    bool  invert_z            = false;
    float yaw_sensitivity     = 1.0f;
    float pitch_sensitivity   = 1.0f;
    float roll_sensitivity    = 1.0f;
    float position_sensitivity = 1.0f;
    float yaw_deadzone_deg    = 0.0f;
    float pitch_deadzone_deg  = 0.0f;
    bool  apply_position      = true;     // 6DOF when true, 3DOF when false
};
Config& config();

// UDP listener thread entry. Runs for the lifetime of the DLL.
void start_opentrack_listener();
void stop_opentrack_listener();

// Compose the head-pose rotation/translation onto the game's view matrix.
// Called from the D3D9 proxy's SetTransform(D3DTS_VIEW, ...) interceptor.
void apply_headpose_to_view(D3DMATRIX& view);

// Config file loader — finds vireio-ht.ini next to the DLL.
void load_config_from_ini(const wchar_t* dll_path);

}  // namespace vireio_ht
