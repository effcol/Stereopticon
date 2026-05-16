// main.cpp — DllMain entry point + the two d3d9 export wrappers.
//
// When the game calls Direct3DCreate9 it resolves to OUR exported function
// (Windows DLL-search-order picks the proxy in the game folder over the
// system DLL). We forward to the real d3d9.dll, then wrap the returned
// IDirect3D9 in our own proxy so we can intercept the device's SetTransform.
#include "vireio_ht.h"

#include <thread>
#include <atomic>

extern IDirect3D9*   create_d3d9_proxy(IDirect3D9*   real);
extern IDirect3D9Ex* create_d3d9ex_proxy(IDirect3D9Ex* real);

namespace vireio_ht {

static HeadPose g_pose;
static Config   g_config;
HeadPose& pose()   { return g_pose; }
Config&   config() { return g_config; }

}  // namespace vireio_ht

namespace {

// Real d3d9.dll handle. Resolved on first Direct3DCreate9 call.
HMODULE  g_real_d3d9 = nullptr;
std::atomic<bool> g_init_done{ false };

using PFN_Direct3DCreate9   = IDirect3D9*   (WINAPI*)(UINT SDKVersion);
using PFN_Direct3DCreate9Ex = HRESULT       (WINAPI*)(UINT SDKVersion, IDirect3D9Ex** ppD3D);

PFN_Direct3DCreate9   g_real_Direct3DCreate9   = nullptr;
PFN_Direct3DCreate9Ex g_real_Direct3DCreate9Ex = nullptr;

void initialize_once() {
    if (g_init_done.exchange(true)) return;

    wchar_t sys_path[MAX_PATH];
    GetSystemDirectoryW(sys_path, MAX_PATH);
    wcscat_s(sys_path, MAX_PATH, L"\\d3d9.dll");
    g_real_d3d9 = LoadLibraryW(sys_path);
    if (!g_real_d3d9) {
        OutputDebugStringA("[vireio-ht] FATAL: failed to load real d3d9.dll\n");
        return;
    }
    g_real_Direct3DCreate9   = (PFN_Direct3DCreate9)  GetProcAddress(g_real_d3d9, "Direct3DCreate9");
    g_real_Direct3DCreate9Ex = (PFN_Direct3DCreate9Ex)GetProcAddress(g_real_d3d9, "Direct3DCreate9Ex");

    // Load vireio-ht.ini next to OUR dll if present.
    wchar_t dll_path[MAX_PATH];
    HMODULE self = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&initialize_once), &self);
    GetModuleFileNameW(self, dll_path, MAX_PATH);
    vireio_ht::load_config_from_ini(dll_path);

    vireio_ht::start_opentrack_listener();
    OutputDebugStringA("[vireio-ht] initialised\n");
}

}  // namespace

BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_DETACH) {
        vireio_ht::stop_opentrack_listener();
        if (g_real_d3d9) { FreeLibrary(g_real_d3d9); g_real_d3d9 = nullptr; }
    }
    return TRUE;
}

extern "C" __declspec(dllexport) IDirect3D9* WINAPI Direct3DCreate9(UINT SDKVersion) {
    initialize_once();
    if (!g_real_Direct3DCreate9) return nullptr;
    IDirect3D9* real = g_real_Direct3DCreate9(SDKVersion);
    return real ? create_d3d9_proxy(real) : nullptr;
}

extern "C" __declspec(dllexport) HRESULT WINAPI Direct3DCreate9Ex(UINT SDKVersion, IDirect3D9Ex** ppD3D) {
    initialize_once();
    if (!g_real_Direct3DCreate9Ex || !ppD3D) return E_NOINTERFACE;
    IDirect3D9Ex* real = nullptr;
    HRESULT hr = g_real_Direct3DCreate9Ex(SDKVersion, &real);
    if (FAILED(hr) || !real) { *ppD3D = nullptr; return hr; }
    *ppD3D = create_d3d9ex_proxy(real);
    return S_OK;
}
