// track_pipeline.h — Leia head pose to OpenTrack mapping
// Pipeline: orientation input -> One-Euro filter -> sensitivity/offset -> clamp
#pragma once

#include "one_euro_filter.h"
#include "sma_filter.h"
#include <cmath>
#include <algorithm>

struct TrackConfig {
    // One-Euro filter (position: slower/smoother; rotation: faster/responsive)
    float filter_freq           = 60.0f;
    float filter_pos_mincutoff  = 0.08f;  // Position smoothing
    float filter_pos_beta       = 0.08f;  // Position adaptation speed
    float filter_rot_mincutoff  = 0.001f;  // Rotation smoothing - LOW NOISE (0.001 = minimal smoothing)
    float filter_rot_beta       = 0.001f;  // Rotation adaptation speed - VERY SMOOTH
    float angle_deadzone_deg    = 0.2f;

    // Orientation conversion. Leia outputs are typically radians.
    bool orientation_radians = true;

    // Axis sensitivity and offsets (degrees in, degrees out)
    float sens_yaw         = 1.0f;
    float sens_pitch       = 1.0f;
    float sens_roll        = 1.0f;
    float yaw_offset       = 0.0f;
    float pitch_offset     = 0.0f;
    float roll_offset      = 0.0f;

    // Output clamp (degrees)
    float max_yaw          = 70.0f;
    float max_pitch        = 70.0f;
    float max_roll         = 70.0f;

    // Translation passthrough from monitor frame (cm)
    bool passthrough_translation = true;
    bool invert_x = true;    // OpenTrack convention
    bool invert_yaw = true;  // OpenTrack convention
    bool invert_roll = false;  // Tracker outputs correct orientation; set to true if inverted

    // Output modes (ordered by recommendation for best stability)
    // 1: XYZ + Yaw/Pitch (RECOMMENDED DEFAULT - best for most games)
    // 2: XYZ only (position tracking only)
    // 3: Yaw/Pitch only (rotation without roll; gimbal-lock free)
    // 4: X/Y/Z + Yaw/Pitch/Roll (all 6DOF; less stable in quick head turns)
    // 5: Yaw/Pitch/Roll only (rotation tracking only)
    int output_mode = 1;

    // Output target: 1 = OpenTrack (One-Euro), 2 = SteamVR/VRto3D (SMA)
    int output_target = 1;
};

struct TrackResult {
    float yaw_deg   = 0.0f;
    float pitch_deg = 0.0f;
    float roll_deg  = 0.0f;
    float pos_x_cm  = 0.0f;
    float pos_y_cm  = 0.0f;
    float pos_z_cm  = 0.0f;
    float raw_yaw_deg = 0.0f;
    float raw_pitch_deg = 0.0f;
    float raw_roll_deg = 0.0f;
    bool  valid     = false;
};

class TrackPipeline {
    OneEuroFilter filter_yaw_, filter_pitch_, filter_roll_;
    OneEuroFilter filter_pos_x_, filter_pos_y_, filter_pos_z_;
    TrackConfig cfg_;

public:
    static float apply_deadzone(float v, float dz) {
        if (std::fabs(v) < dz) return 0.0f;
        return v;
    }
    TrackPipeline() { reset_filters(); }
    explicit TrackPipeline(const TrackConfig& cfg) : cfg_(cfg) { reset_filters(); }

    void reset_filters() {
        filter_yaw_ = OneEuroFilter(cfg_.filter_freq, cfg_.filter_rot_mincutoff, cfg_.filter_rot_beta);
        filter_pitch_ = OneEuroFilter(cfg_.filter_freq, cfg_.filter_rot_mincutoff, cfg_.filter_rot_beta);
        filter_roll_ = OneEuroFilter(cfg_.filter_freq, cfg_.filter_rot_mincutoff, cfg_.filter_rot_beta);
        filter_pos_x_ = OneEuroFilter(cfg_.filter_freq, cfg_.filter_pos_mincutoff, cfg_.filter_pos_beta);
        filter_pos_y_ = OneEuroFilter(cfg_.filter_freq, cfg_.filter_pos_mincutoff, cfg_.filter_pos_beta);
        filter_pos_z_ = OneEuroFilter(cfg_.filter_freq, cfg_.filter_pos_mincutoff, cfg_.filter_pos_beta);
    }

    TrackResult process(
        float pos_x_mm,
        float pos_y_mm,
        float pos_z_mm,
        float orient_x,
        float orient_y,
        float orient_z,
        float timestamp_sec)
    {
        TrackResult r;

        if (!std::isfinite(orient_x) || !std::isfinite(orient_y) || !std::isfinite(orient_z)) {
            r.valid = false;
            return r;
        }

        const float to_deg = cfg_.orientation_radians ? (180.0f / static_cast<float>(M_PI)) : 1.0f;
        r.raw_pitch_deg = orient_x * to_deg;
        r.raw_yaw_deg = orient_y * to_deg;
        r.raw_roll_deg = orient_z * to_deg;

        float yaw_f = filter_yaw_.filter(r.raw_yaw_deg, timestamp_sec);
        float pitch_f = filter_pitch_.filter(r.raw_pitch_deg, timestamp_sec);
        float roll_f = filter_roll_.filter(r.raw_roll_deg, timestamp_sec);

        if (cfg_.invert_yaw) yaw_f = -yaw_f;
        if (cfg_.invert_roll) roll_f = -roll_f;

        r.yaw_deg = std::clamp((yaw_f + cfg_.yaw_offset) * cfg_.sens_yaw, -cfg_.max_yaw, cfg_.max_yaw);
        r.pitch_deg = std::clamp((pitch_f + cfg_.pitch_offset) * cfg_.sens_pitch, -cfg_.max_pitch, cfg_.max_pitch);
        r.roll_deg = std::clamp((roll_f + cfg_.roll_offset) * cfg_.sens_roll, -cfg_.max_roll, cfg_.max_roll);

        r.yaw_deg = apply_deadzone(r.yaw_deg, cfg_.angle_deadzone_deg);
        r.pitch_deg = apply_deadzone(r.pitch_deg, cfg_.angle_deadzone_deg);
        r.roll_deg = apply_deadzone(r.roll_deg, cfg_.angle_deadzone_deg);

        if (!std::isfinite(r.yaw_deg))   r.yaw_deg   = 0.0f;
        if (!std::isfinite(r.pitch_deg)) r.pitch_deg = 0.0f;
        if (!std::isfinite(r.roll_deg))  r.roll_deg  = 0.0f;

        if (cfg_.passthrough_translation) {
            // Position filtering disabled; filter only applies to rotation (YPR)
            float x_cm = pos_x_mm / 10.0f;
            float y_cm = pos_y_mm / 10.0f;
            float z_cm = pos_z_mm / 10.0f;
            if (cfg_.invert_x) x_cm = -x_cm;
            r.pos_x_cm = x_cm;
            r.pos_y_cm = y_cm;
            r.pos_z_cm = z_cm;
        }

        switch (cfg_.output_mode) {
            case 1: // XYZ + Yaw/Pitch (RECOMMENDED DEFAULT - best all-round)
                r.roll_deg = 0.0f;
                break;
            case 2: // XYZ only (position tracking only)
                r.yaw_deg = 0.0f;
                r.pitch_deg = 0.0f;
                r.roll_deg = 0.0f;
                break;
            case 3: // Yaw/Pitch only (rotation without roll)
                r.pos_x_cm = 0.0f;
                r.pos_y_cm = 0.0f;
                r.pos_z_cm = 0.0f;
                r.roll_deg = 0.0f;
                break;
            case 4: // All 6 axes: X/Y/Z + Yaw/Pitch/Roll
                // All 6DOF enabled (less stable, use with caution)
                break;
            case 5: // Yaw/Pitch/Roll only (rotation tracking only)
                r.pos_x_cm = 0.0f;
                r.pos_y_cm = 0.0f;
                r.pos_z_cm = 0.0f;
                break;
            default:
                break;
        }

        r.valid = true;
        return r;
    }

    TrackConfig& config() { return cfg_; }
    const TrackConfig& config() const { return cfg_; }
};

class TrackPipelineSMA {
    SMAFilter sma_yaw_, sma_pitch_, sma_roll_;
    SMAFilter sma_pos_x_, sma_pos_y_, sma_pos_z_;
    TrackConfig cfg_;
public:
    TrackPipelineSMA() : sma_yaw_(5), sma_pitch_(5), sma_roll_(5), sma_pos_x_(5), sma_pos_y_(5), sma_pos_z_(5) {}
    explicit TrackPipelineSMA(const TrackConfig& cfg) : cfg_(cfg), sma_yaw_(5), sma_pitch_(5), sma_roll_(5), sma_pos_x_(5), sma_pos_y_(5), sma_pos_z_(5) {}
    void reset_filters() {
        sma_yaw_.reset(); sma_pitch_.reset(); sma_roll_.reset();
        sma_pos_x_.reset(); sma_pos_y_.reset(); sma_pos_z_.reset();
    }
    TrackResult process(
        float pos_x_mm,
        float pos_y_mm,
        float pos_z_mm,
        float orient_x,
        float orient_y,
        float orient_z,
        float /*timestamp_sec*/)
    {
        TrackResult r;
        if (!std::isfinite(orient_x) || !std::isfinite(orient_y) || !std::isfinite(orient_z)) {
            r.valid = false;
            return r;
        }
        const float to_deg = cfg_.orientation_radians ? (180.0f / static_cast<float>(M_PI)) : 1.0f;
        r.raw_pitch_deg = orient_x * to_deg;
        r.raw_yaw_deg = orient_y * to_deg;
        r.raw_roll_deg = orient_z * to_deg;
        float yaw_f = sma_yaw_.filter(r.raw_yaw_deg);
        float pitch_f = sma_pitch_.filter(r.raw_pitch_deg);
        float roll_f = sma_roll_.filter(r.raw_roll_deg);
        if (cfg_.invert_yaw) yaw_f = -yaw_f;
        if (cfg_.invert_roll) roll_f = -roll_f;
        r.yaw_deg = std::clamp((yaw_f + cfg_.yaw_offset) * cfg_.sens_yaw, -cfg_.max_yaw, cfg_.max_yaw);
        r.pitch_deg = std::clamp((pitch_f + cfg_.pitch_offset) * cfg_.sens_pitch, -cfg_.max_pitch, cfg_.max_pitch);
        r.roll_deg = std::clamp((roll_f + cfg_.roll_offset) * cfg_.sens_roll, -cfg_.max_roll, cfg_.max_roll);
        r.yaw_deg = TrackPipeline::apply_deadzone(r.yaw_deg, cfg_.angle_deadzone_deg);
        r.pitch_deg = TrackPipeline::apply_deadzone(r.pitch_deg, cfg_.angle_deadzone_deg);
        r.roll_deg = TrackPipeline::apply_deadzone(r.roll_deg, cfg_.angle_deadzone_deg);
        if (!std::isfinite(r.yaw_deg))   r.yaw_deg   = 0.0f;
        if (!std::isfinite(r.pitch_deg)) r.pitch_deg = 0.0f;
        if (!std::isfinite(r.roll_deg))  r.roll_deg  = 0.0f;
        if (cfg_.passthrough_translation) {
            float x_cm = pos_x_mm / 10.0f;
            float y_cm = pos_y_mm / 10.0f;
            float z_cm = pos_z_mm / 10.0f;
            if (cfg_.invert_x) x_cm = -x_cm;
            r.pos_x_cm = sma_pos_x_.filter(x_cm);
            r.pos_y_cm = sma_pos_y_.filter(y_cm);
            r.pos_z_cm = sma_pos_z_.filter(z_cm);
        }
        switch (cfg_.output_mode) {
            case 1: r.roll_deg = 0.0f; break;
            case 2: r.yaw_deg = 0.0f; r.pitch_deg = 0.0f; r.roll_deg = 0.0f; break;
            case 3: r.pos_x_cm = 0.0f; r.pos_y_cm = 0.0f; r.pos_z_cm = 0.0f; r.roll_deg = 0.0f; break;
            case 4: break;
            case 5: r.pos_x_cm = 0.0f; r.pos_y_cm = 0.0f; r.pos_z_cm = 0.0f; break;
            default: break;
        }
        r.valid = true;
        return r;
    }
    TrackConfig& config() { return cfg_; }
    const TrackConfig& config() const { return cfg_; }
};
