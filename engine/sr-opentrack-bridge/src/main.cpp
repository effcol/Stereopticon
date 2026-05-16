// Simulated_Reality_OpenTrack_Bridge — Standalone Leia head pose to OpenTrack UDP converter
// Reads LeiaSR Runtime head pose, filters orientation, forwards 6DOF to OpenTrack,
// sends as OpenTrack UDP to OpenTrack. Console app for parameter tuning.
//
// Usage: Run with OpenTrack.
//        Turn/tilt naturally. Use hotkeys to tune parameters.

#define NOMINMAX
#include <winsock2.h>  // Must be before windows.h
#include <windows.h>

#include <iostream>
#include <fstream>
#include <string>
#include <chrono>
#include <thread>
#include <mutex>
#include <atomic>
#include <conio.h>
#include <cstdio>
#include <algorithm>

#include "sr/management/srcontext.h"
#include "sr/utility/exception.h"
#include "sr/sense/headtracker/headposetracker.h"
#include "sr/sense/core/inputstream.h"

#include "one_euro_filter.h"
#include "sma_filter.h"
#include "track_pipeline.h"
#include "opentrack_udp.h"

// Ctrl+letter codes returned by _getch() on Windows
#define CTRL_L  12
#define CTRL_X  24

// --- Head pose listener ---

class HeadPoseListener : public SR::HeadPoseListener {
    std::mutex mutex_;
    float pos_[3] = {0.0f, 0.0f, 600.0f};
    float orient_[3] = {0.0f, 0.0f, 0.0f};
    uint64_t frame_time_ = 0;
    bool has_data_ = false;

public:
    SR::InputStream<SR::HeadPoseStream> stream;

    void accept(const SR_headPose& frame) override {
        std::lock_guard<std::mutex> lock(mutex_);
        pos_[0] = static_cast<float>(frame.position.x);
        pos_[1] = static_cast<float>(frame.position.y);
        pos_[2] = static_cast<float>(frame.position.z);
        orient_[0] = static_cast<float>(frame.orientation.x);
        orient_[1] = static_cast<float>(frame.orientation.y);
        orient_[2] = static_cast<float>(frame.orientation.z);
        frame_time_ = frame.time;
        has_data_ = true;
    }

    bool get(float pos[3], float orient[3], uint64_t& time_us) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!has_data_) return false;
        pos[0] = pos_[0]; pos[1] = pos_[1]; pos[2] = pos_[2];
        orient[0] = orient_[0]; orient[1] = orient_[1]; orient[2] = orient_[2];
        time_us = frame_time_;
        return true;
    }
};

// --- Config file (saved next to executable) ---

static std::string get_config_path() {
    // Save config next to the executable (not in Steam directories)
    char exe_path[MAX_PATH];
    GetModuleFileNameA(nullptr, exe_path, MAX_PATH);
    std::string path(exe_path);
    auto last_slash = path.find_last_of("\\/");
    if (last_slash != std::string::npos) path = path.substr(0, last_slash + 1);
    return path + "opentrack_bridge_config.txt";
}

static bool save_config(const TrackConfig& cfg) {
    std::string path = get_config_path();
    std::ofstream f(path);
    if (!f.is_open()) return false;

    f << "# Simulated Reality OpenTrack Bridge — Settings\n";
    f << "# Edit values here or tune in-app with hotkeys (auto-saves).\n\n";
    f << "# Position filter (XYZ)\n";
    f << "filter_pos_mincutoff = " << cfg.filter_pos_mincutoff << "\n";
    f << "filter_pos_beta = " << cfg.filter_pos_beta << "\n";
    f << "# Rotation filter (Yaw/Pitch/Roll) - increase beta for more responsiveness\n";
    f << "filter_rot_mincutoff = " << cfg.filter_rot_mincutoff << "\n";
    f << "filter_rot_beta = " << cfg.filter_rot_beta << "\n";
    f << "angle_deadzone_deg = " << cfg.angle_deadzone_deg << "\n";
    f << "orientation_radians = " << (cfg.orientation_radians ? 1 : 0) << "\n";
    f << "sens_yaw = " << cfg.sens_yaw << "\n";
    f << "sens_pitch = " << cfg.sens_pitch << "\n";
    f << "sens_roll = " << cfg.sens_roll << "\n";
    f << "yaw_offset = " << cfg.yaw_offset << "\n";
    f << "pitch_offset = " << cfg.pitch_offset << "\n";
    f << "roll_offset = " << cfg.roll_offset << "\n";
    f << "max_yaw = " << cfg.max_yaw << "\n";
    f << "max_pitch = " << cfg.max_pitch << "\n";
    f << "max_roll = " << cfg.max_roll << "\n";
    f << "passthrough_translation = " << (cfg.passthrough_translation ? 1 : 0) << "\n";
    f << "invert_x = " << (cfg.invert_x ? 1 : 0) << "\n";
    f << "invert_yaw = " << (cfg.invert_yaw ? 1 : 0) << "\n";
    f << "invert_roll = " << (cfg.invert_roll ? 1 : 0) << "\n";
    f << "output_mode = " << cfg.output_mode << "\n";
    f << "output_target = " << cfg.output_target << "\n";

    f.close();
    return true;
}

static bool load_config(TrackConfig& cfg) {
    std::string path = get_config_path();
    std::ifstream f(path);
    if (!f.is_open()) return false;

    std::string line;
    while (std::getline(f, line)) {
        if (line.empty() || line[0] == '#') continue;

        auto eq = line.find('=');
        if (eq == std::string::npos) continue;

        std::string key = line.substr(0, eq);
        std::string val = line.substr(eq + 1);

        auto trim = [](std::string& s) {
            while (!s.empty() && s.front() == ' ') s.erase(s.begin());
            while (!s.empty() && s.back() == ' ') s.pop_back();
        };
        trim(key);
        trim(val);

        try {
            float v = std::stof(val);
            if (!std::isfinite(v)) continue;

            // New separate rotation/position parameters
            if (key == "filter_pos_mincutoff") cfg.filter_pos_mincutoff = v;
            else if (key == "filter_pos_beta") cfg.filter_pos_beta = v;
            else if (key == "filter_rot_mincutoff") cfg.filter_rot_mincutoff = v;
            else if (key == "filter_rot_beta") cfg.filter_rot_beta = v;
            // Backward compat: old single parameters set rotation (most tuning was rotation-focused)
            else if (key == "filter_mincutoff") { cfg.filter_rot_mincutoff = v; cfg.filter_pos_mincutoff = v; }
            else if (key == "filter_beta") { cfg.filter_rot_beta = v; cfg.filter_pos_beta = v; }
            else if (key == "orientation_radians") cfg.orientation_radians = (v != 0.0f);
            else if (key == "sens_yaw") cfg.sens_yaw = v;
            else if (key == "sens_pitch") cfg.sens_pitch = v;
            else if (key == "sens_roll") cfg.sens_roll = v;
            else if (key == "yaw_offset") cfg.yaw_offset = v;
            else if (key == "pitch_offset") cfg.pitch_offset = v;
            else if (key == "roll_offset") cfg.roll_offset = v;
            else if (key == "max_yaw") cfg.max_yaw = v;
            else if (key == "max_pitch") cfg.max_pitch = v;
            else if (key == "max_roll") cfg.max_roll = v;
            else if (key == "passthrough_translation") cfg.passthrough_translation = (v != 0.0f);
            else if (key == "angle_deadzone_deg") cfg.angle_deadzone_deg = v;
            else if (key == "invert_x") cfg.invert_x = (v != 0.0f);
            else if (key == "invert_yaw") cfg.invert_yaw = (v != 0.0f);
            else if (key == "invert_roll") cfg.invert_roll = (v != 0.0f);
            else if (key == "output_mode") cfg.output_mode = static_cast<int>(v);
            else if (key == "output_target") cfg.output_target = static_cast<int>(v);
        } catch (...) {
            continue;
        }
    }
    cfg.output_mode = std::clamp(cfg.output_mode, 1, 5);
    cfg.angle_deadzone_deg = std::clamp(cfg.angle_deadzone_deg, 0.0f, 5.0f);
    
    // Clamp filter parameters
    cfg.filter_pos_mincutoff = std::clamp(cfg.filter_pos_mincutoff, 0.001f, 10.0f);
    cfg.filter_pos_beta = std::clamp(cfg.filter_pos_beta, 0.001f, 100.0f);
    cfg.filter_rot_mincutoff = std::clamp(cfg.filter_rot_mincutoff, 0.001f, 10.0f);
    cfg.filter_rot_beta = std::clamp(cfg.filter_rot_beta, 0.001f, 100.0f);
    
    return true;
}

static const char* mode_name(int mode) {
    switch (mode) {
        case 1: return "XYZ + Yaw/Pitch (most stable)";
        case 2: return "XYZ only (position tracking)";
        case 3: return "Yaw/Pitch only (rotation without roll)";
        case 4: return "All 6 DOF (full 6DOF tracking)";
        case 5: return "Yaw/Pitch/Roll only (full 3DOF rotation)";
        default: return "Unknown";
    }
}

// 1 = OpenTrack
static const char* output_target_name(int output_target) {
    return "OpenTrack";
}

static void apply_output_target(TrackConfig& cfg) {
    // OpenTrack inversion settings are now controlled via config file (defaults set in TrackConfig)
    // This function is kept for future expansion if needed
    (void)cfg;  // Unused parameter
}

// --- Console helpers ---

static void print_banner() {
    std::printf("========================================================\n");
    std::printf("  Simulated Reality OpenTrack Bridge v0.4   by evilkermitreturns & effcol\n");
    std::printf("========================================================\n");
    std::printf("  Leia head pose -> One-Euro filter -> OpenTrack UDP\n");
    std::printf("  Standalone head tracking for any game that supports OpenTrack.\n");
    std::printf("  Requires: Simulated Reality display + OpenTrack \n");
    std::printf("========================================================\n\n");
    std::printf("  CONTROLS (only active when this window is focused)\n");
    std::printf("    Ctrl+L  Lock/unlock hotkeys (prevent accidental changes)\n");
    std::printf("    Ctrl+X  Calibrate (set current head orientation as neutral)\n");
    std::printf("    1/2     Yaw/Pitch/Roll smoothness (min_cutoff down/up)\n");
    std::printf("    3/4     Yaw/Pitch/Roll response (beta down/up - 4 for more snap)\n");
    std::printf("    5/6     Yaw sensitivity (down/up)\n");
    std::printf("    7/8     Pitch sensitivity (down/up)\n");
    std::printf("    9/0     Roll sensitivity (down/up)\n");
    std::printf("    -/=     Toggle translation passthrough\n");
    std::printf("    [/]     Toggle radians/degrees orientation input\n");
    std::printf("\n");
    std::printf("  TRACKING TYPES (recommended: Z or X)\n");
    std::printf("    Z  XYZ + Yaw/Pitch (3D position + head rotation)\n");
    std::printf("    X  XYZ only (3D position, no head rotation)\n");
    std::printf("    C  Yaw/Pitch only (head rotation without roll)\n");
    std::printf("    V  All 6 axes: X/Y/Z + Yaw/Pitch/Roll (full 6DOF)\n");
    std::printf("    B  Yaw/Pitch/Roll only (3DOF head rotation only)\n");
    std::printf("\n");
    std::printf("  Settings auto-save on every change.\n");
    std::printf("  Config: opentrack_bridge_config.txt (next to executable)\n");
    std::printf("========================================================\n\n");
}

// --- Main ---

int main(int argc, char** argv) {
    // Prevent Ctrl+C from killing app without cleanup
    SetConsoleCtrlHandler(nullptr, TRUE);

    // Parse CLI flags. Defaults match standalone use (direct UDP 4242 to games).
    // When Stereopticon chains us through OpenTrack it passes --output-port 4243
    // so OpenTrack listens on 4243 and re-emits to games on 4242.
    //   --output-host <ip>      destination IP (default 127.0.0.1)
    //   --output-port <port>    destination UDP port (default 4242)
    std::string output_host = "127.0.0.1";
    int output_port = 4242;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--output-host" && i + 1 < argc) output_host = argv[++i];
        else if (a == "--output-port" && i + 1 < argc) output_port = std::atoi(argv[++i]);
    }

    print_banner();

    // 1. Init UDP sender
    OpenTrackSender sender;
    if (!sender.init(output_host.c_str(), output_port)) {
        std::printf("ERROR: Failed to initialize UDP socket (%s:%d).\n", output_host.c_str(), output_port);
        return 1;
    }
    std::printf("[OK] UDP sender ready (%s:%d)\n", output_host.c_str(), output_port);

    // 2. Init Leia SDK
    SR::SRContext* context = nullptr;
    SR::HeadPoseTracker* tracker = nullptr;
    HeadPoseListener listener;

    try {
        context = new SR::SRContext();
        std::printf("[OK] SR Context created\n");
    } catch (SR::ServerNotAvailableException&) {
        std::printf("ERROR: Leia SR Service not available.\n");
        std::printf("       Make sure the SR Platform is installed and running.\n");
        return 1;
    } catch (std::runtime_error& e) {
        std::printf("ERROR: SR Context failed: %s\n", e.what());
        return 1;
    }

    try {
        tracker = SR::HeadPoseTracker::create(*context);
        listener.stream.set(tracker->openHeadPoseStream(&listener));
        context->initialize();
        std::printf("[OK] Head pose tracker started\n");
    } catch (std::exception& e) {
        std::printf("ERROR: Head pose tracker init failed: %s\n", e.what());
        delete context;
        return 1;
    }

    // 3. Create pipeline (auto-load saved settings if available)
    TrackConfig cfg;
    if (load_config(cfg)) {
        std::printf("[OK] Settings loaded from: %s\n", get_config_path().c_str());
    }
    apply_output_target(cfg);
    TrackPipeline pipeline(cfg);
    TrackPipelineSMA pipeline_sma(cfg);

    std::printf("[OK] Output target: OpenTrack\n");
    std::printf("[OK] Axis inversion: X=%s Yaw=%s Roll=%s (OpenTrack convention)\n",
        cfg.invert_x ? "ON" : "OFF",
        cfg.invert_yaw ? "ON" : "OFF",
        cfg.invert_roll ? "ON" : "OFF");
    std::printf("[OK] Tracking type: %d (%s)\n", cfg.output_mode, mode_name(cfg.output_mode));
    // 4. Wait for first head pose data
    std::printf("\nWaiting for head pose data...\n");
    float pos[3], orient[3];
    uint64_t time_us;
    bool got_first = false;

    for (int i = 0; i < 300 && !got_first; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(16));
        if (listener.get(pos, orient, time_us)) got_first = true;
    }

    if (!got_first) {
        std::printf("WARNING: No head pose detected after 5 seconds. Continuing anyway.\n");
    } else {
        std::printf("[OK] Head pose stream active.\n");
    }
    std::printf("[OK] Using monitor reference frame (no manual recenter).\n\n");

    // 5. Main loop
    auto start_time = std::chrono::high_resolution_clock::now();
    int frame_count = 0;
    int udp_sent_count = 0;
    int udp_fail_count = 0;
    bool pose_lost_announced = false;
    bool keys_locked = false;

    while (true) {
        auto loop_start = std::chrono::high_resolution_clock::now();

        if (listener.get(pos, orient, time_us)) {
            auto now = std::chrono::high_resolution_clock::now();
            float timestamp_sec = std::chrono::duration<float>(now - start_time).count();

            TrackResult r;
            if (cfg.output_target == 1) {
                r = pipeline.process(
                    pos[0], pos[1], pos[2],
                    orient[0], orient[1], orient[2],
                    timestamp_sec);
            } else {
                r = pipeline_sma.process(
                    pos[0], pos[1], pos[2],
                    orient[0], orient[1], orient[2],
                    timestamp_sec);
            }

            if (r.valid) {
                bool sent_ok = sender.send(
                    r.pos_x_cm, r.pos_y_cm, r.pos_z_cm,
                    r.yaw_deg, r.pitch_deg, r.roll_deg);
                if (sent_ok) udp_sent_count++; else udp_fail_count++;
                pose_lost_announced = false;

                if (frame_count % 30 == 0) {
                    std::printf("\r  Pos(cm): X=%+5.1f Y=%+5.1f Z=%+5.1f | Raw(deg): Y=%+5.1f P=%+5.1f R=%+5.1f | Out: Y=%+5.1f P=%+5.1f R=%+5.1f | UDP:%d",
                        r.pos_x_cm, r.pos_y_cm, r.pos_z_cm,
                        r.raw_yaw_deg, r.raw_pitch_deg, r.raw_roll_deg,
                        r.yaw_deg, r.pitch_deg, r.roll_deg,
                        udp_sent_count);
                    if (udp_fail_count > 0) std::printf(" FAIL:%d", udp_fail_count);
                    if (keys_locked) std::printf(" [LOCKED]");
                    std::printf(" Z:%d", cfg.output_mode);
                    std::printf("   ");
                    std::fflush(stdout);
                }
            } else {
                sender.sendIdentity();
                if (!pose_lost_announced) {
                    std::printf("\n  [POSE LOST] Sending identity rotation\n");
                    pose_lost_announced = true;
                }
            }
        }

        // Handle input
        bool config_changed = false;

        while (_kbhit()) {
            int key = _getch();

            // Ctrl+L = toggle lock
            if (key == CTRL_L) {
                keys_locked = !keys_locked;
                std::printf("\n  [%s] Tuning hotkeys %s.\n",
                    keys_locked ? "LOCKED" : "UNLOCKED",
                    keys_locked ? "disabled" : "enabled");
                continue;
            }

            // Ctrl+X = calibrate (set current head orientation as neutral)
            if (key == CTRL_X) {
                float pos[3], orient[3];
                uint64_t time_us;
                if (listener.get(pos, orient, time_us)) {
                    const float to_deg = cfg.orientation_radians ? (180.0f / static_cast<float>(M_PI)) : 1.0f;
                    cfg.yaw_offset = -orient[1] * to_deg;
                    cfg.pitch_offset = -orient[0] * to_deg;
                    cfg.roll_offset = -orient[2] * to_deg;
                    pipeline.config().yaw_offset = cfg.yaw_offset;
                    pipeline.config().pitch_offset = cfg.pitch_offset;
                    pipeline.config().roll_offset = cfg.roll_offset;
                    std::printf("\n  [CALIBRATED] Head orientation set as neutral (Yaw/Pitch/Roll now at zero)\n");
                    config_changed = true;
                } else {
                    std::printf("\n  [CALIBRATION FAILED] No head pose data available\n");
                }
                continue;
            }

            // All tuning keys below are blocked when locked
            if (keys_locked) continue;

            switch (key) {
                // Smoothing: 1/2 = rotation min_cutoff down/up (increase = less smooth, more responsive)
                case '1':
                    cfg.filter_rot_mincutoff = std::max(0.001f, cfg.filter_rot_mincutoff / 2.0f);
                    pipeline.config().filter_rot_mincutoff = cfg.filter_rot_mincutoff;
                    pipeline.reset_filters();
                    std::printf("\n  Rotation min_cutoff = %.4f (smoother, less responsive)\n", cfg.filter_rot_mincutoff);
                    config_changed = true;
                    break;
                case '2':
                    cfg.filter_rot_mincutoff = std::min(10.0f, cfg.filter_rot_mincutoff * 2.0f);
                    pipeline.config().filter_rot_mincutoff = cfg.filter_rot_mincutoff;
                    pipeline.reset_filters();
                    std::printf("\n  Rotation min_cutoff = %.4f (less smooth, more responsive)\n", cfg.filter_rot_mincutoff);
                    config_changed = true;
                    break;
                // Direct output-mode keys on keyboard Z-row
                case 'z':
                case 'Z':
                    cfg.output_mode = 1;
                    pipeline.config().output_mode = cfg.output_mode;
                    std::printf("\n  Tracking type 1: %s\n", mode_name(1));
                    config_changed = true;
                    break;
                case 'x':
                case 'X':
                    cfg.output_mode = 2;
                    pipeline.config().output_mode = cfg.output_mode;
                    std::printf("\n  Tracking type 2: %s\n", mode_name(2));
                    config_changed = true;
                    break;
                case 'c':
                case 'C':
                    cfg.output_mode = 3;
                    pipeline.config().output_mode = cfg.output_mode;
                    std::printf("\n  Tracking type 3: %s\n", mode_name(3));
                    config_changed = true;
                    break;
                case 'v':
                case 'V':
                    cfg.output_mode = 4;
                    pipeline.config().output_mode = cfg.output_mode;
                    std::printf("\n  Tracking type 4: %s\n", mode_name(4));
                    config_changed = true;
                    break;
                case 'b':
                case 'B':
                    cfg.output_mode = 5;
                    pipeline.config().output_mode = cfg.output_mode;
                    std::printf("\n  Tracking type 5: %s\n", mode_name(5));
                    config_changed = true;
                    break;

                // Response: 3/4 = rotation beta down/up (increase = more responsive to head turns)
                case '3':
                    cfg.filter_rot_beta = std::max(0.001f, cfg.filter_rot_beta / 10.0f);
                    pipeline.config().filter_rot_beta = cfg.filter_rot_beta;
                    pipeline.reset_filters();
                    std::printf("\n  Rotation beta = %.4f (slower to adapt, less responsive)\n", cfg.filter_rot_beta);
                    config_changed = true;
                    break;
                case '4':
                    cfg.filter_rot_beta = std::min(100.0f, cfg.filter_rot_beta * 10.0f);
                    pipeline.config().filter_rot_beta = cfg.filter_rot_beta;
                    pipeline.reset_filters();
                    std::printf("\n  Rotation beta = %.4f (faster to adapt, more responsive - TRY THIS!)\n", cfg.filter_rot_beta);
                    config_changed = true;
                    break;

                // Yaw sensitivity: 5/6
                case '5':
                    cfg.sens_yaw = std::max(0.5f, cfg.sens_yaw - 0.5f);
                    pipeline.config().sens_yaw = cfg.sens_yaw;
                    std::printf("\n  sens_yaw = %.1f\n", cfg.sens_yaw);
                    config_changed = true;
                    break;
                case '6':
                    cfg.sens_yaw = std::min(20.0f, cfg.sens_yaw + 0.5f);
                    pipeline.config().sens_yaw = cfg.sens_yaw;
                    std::printf("\n  sens_yaw = %.1f\n", cfg.sens_yaw);
                    config_changed = true;
                    break;

                // Pitch sensitivity: 7/8
                case '7':
                    cfg.sens_pitch = std::max(0.5f, cfg.sens_pitch - 0.5f);
                    pipeline.config().sens_pitch = cfg.sens_pitch;
                    std::printf("\n  sens_pitch = %.1f\n", cfg.sens_pitch);
                    config_changed = true;
                    break;
                case '8':
                    cfg.sens_pitch = std::min(20.0f, cfg.sens_pitch + 0.5f);
                    pipeline.config().sens_pitch = cfg.sens_pitch;
                    std::printf("\n  sens_pitch = %.1f\n", cfg.sens_pitch);
                    config_changed = true;
                    break;

                // Roll sensitivity: 9/0
                case '9':
                    cfg.sens_roll = std::max(0.5f, cfg.sens_roll - 0.5f);
                    pipeline.config().sens_roll = cfg.sens_roll;
                    std::printf("\n  sens_roll = %.1f\n", cfg.sens_roll);
                    config_changed = true;
                    break;
                case '0':
                    cfg.sens_roll = std::min(20.0f, cfg.sens_roll + 0.5f);
                    pipeline.config().sens_roll = cfg.sens_roll;
                    std::printf("\n  sens_roll = %.1f\n", cfg.sens_roll);
                    config_changed = true;
                    break;

                // Toggle translation passthrough
                case '-':
                case '=':
                    cfg.passthrough_translation = !cfg.passthrough_translation;
                    pipeline.config().passthrough_translation = cfg.passthrough_translation;
                    std::printf("\n  passthrough_translation = %s\n", cfg.passthrough_translation ? "ON" : "OFF");
                    config_changed = true;
                    break;

                // Toggle orientation units
                case '[':
                case ']':
                    cfg.orientation_radians = !cfg.orientation_radians;
                    pipeline.config().orientation_radians = cfg.orientation_radians;
                    pipeline.reset_filters();
                    std::printf("\n  orientation_radians = %s\n", cfg.orientation_radians ? "ON" : "OFF");
                    config_changed = true;
                    break;

                // Output target switching
                case 'a':
                case 'A':
                    cfg.output_target = 1;
                    save_config(cfg);
                    std::printf("\n  Output target: OpenTrack (One-Euro filter)\n");
                    continue;
                case 's':
                case 'S':
                    cfg.output_target = 2;
                    save_config(cfg);
                    std::printf("\n  Output target: SteamVR/VRto3D (SMA filter)\n");
                    continue;
            }
        }

        // Auto-save on any change
        if (config_changed) {
            save_config(cfg);
        }

        frame_count++;

        auto loop_end = std::chrono::high_resolution_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(loop_end - loop_start);
        auto remaining = std::chrono::milliseconds(8) - elapsed;
        if (remaining.count() > 0) {
            std::this_thread::sleep_for(remaining);
        }
    }

    // Unreachable in normal operation (user closes window)
    sender.shutdown();
    delete context;
    return 0;
}
