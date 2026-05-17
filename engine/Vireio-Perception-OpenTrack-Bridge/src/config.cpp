// config.cpp — load vireio-ht.ini from beside the DLL. Optional file;
// defaults from Config{} apply when missing or a key is absent.
#include "vireio_ht.h"

#include <fstream>
#include <string>
#include <algorithm>
#include <cstdlib>

namespace vireio_ht {

namespace {

inline std::string trim(const std::string& s) {
    auto a = s.find_first_not_of(" \t\r\n");
    auto b = s.find_last_not_of (" \t\r\n");
    return (a == std::string::npos) ? "" : s.substr(a, b - a + 1);
}

inline bool to_bool(const std::string& v) {
    auto x = v;
    std::transform(x.begin(), x.end(), x.begin(), [](char c){ return (char)std::tolower(c); });
    return x == "1" || x == "true" || x == "yes" || x == "on";
}

inline std::wstring dir_of(const std::wstring& path) {
    auto p = path.find_last_of(L"\\/");
    return (p == std::wstring::npos) ? L"" : path.substr(0, p);
}

}  // namespace

void load_config_from_ini(const wchar_t* dll_path) {
    auto& cfg = config();
    std::wstring ini = dir_of(dll_path) + L"\\vireio-ht.ini";
    std::ifstream f(ini);
    if (!f.is_open()) return;

    std::string line;
    while (std::getline(f, line)) {
        if (line.empty() || line[0] == ';' || line[0] == '#' || line[0] == '[') continue;
        auto eq = line.find('=');
        if (eq == std::string::npos) continue;
        const std::string key = trim(line.substr(0, eq));
        const std::string val = trim(line.substr(eq + 1));

        if      (key == "udp_port")             cfg.udp_port            = std::atoi(val.c_str());
        else if (key == "invert_yaw")           cfg.invert_yaw          = to_bool(val);
        else if (key == "invert_pitch")         cfg.invert_pitch        = to_bool(val);
        else if (key == "invert_roll")          cfg.invert_roll         = to_bool(val);
        else if (key == "invert_x")             cfg.invert_x            = to_bool(val);
        else if (key == "invert_y")             cfg.invert_y            = to_bool(val);
        else if (key == "invert_z")             cfg.invert_z            = to_bool(val);
        else if (key == "yaw_sensitivity")      cfg.yaw_sensitivity     = (float)std::atof(val.c_str());
        else if (key == "pitch_sensitivity")    cfg.pitch_sensitivity   = (float)std::atof(val.c_str());
        else if (key == "roll_sensitivity")     cfg.roll_sensitivity    = (float)std::atof(val.c_str());
        else if (key == "position_sensitivity") cfg.position_sensitivity = (float)std::atof(val.c_str());
        else if (key == "yaw_deadzone_deg")     cfg.yaw_deadzone_deg    = (float)std::atof(val.c_str());
        else if (key == "pitch_deadzone_deg")   cfg.pitch_deadzone_deg  = (float)std::atof(val.c_str());
        else if (key == "apply_position")       cfg.apply_position      = to_bool(val);
    }
}

}  // namespace vireio_ht
