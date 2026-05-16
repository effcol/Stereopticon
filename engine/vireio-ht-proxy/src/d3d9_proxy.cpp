// d3d9_proxy.cpp — IDirect3D9 / IDirect3DDevice9 forwarding wrappers.
// Every method is just `return m_real->Method(args...)` except:
//   - IDirect3D9::CreateDevice / CreateDeviceEx wrap the returned device
//   - IDirect3DDevice9::SetTransform with D3DTS_VIEW intercepts the view
//     matrix and composes the head-pose rotation onto it before forwarding
//
// For Vireio-style head-tracking on fixed-function pipelines this catches
// the right spot. Shader-only games that push the view matrix into vertex
// shader constants need a SetVertexShaderConstantF intercept too — that's
// a follow-up (noted in README.md).
#include "vireio_ht.h"

#include <atomic>

namespace {

// Hand-rolled IUnknown bookkeeping. Avoids ATL/MFC for minimal binary size.
template <typename Iface>
class Proxy : public Iface {
public:
    Proxy(Iface* real) : m_real(real), m_ref(1) {}
    virtual ~Proxy() {}

    // IUnknown
    HRESULT __stdcall QueryInterface(REFIID riid, void** ppv) override {
        return m_real->QueryInterface(riid, ppv);
    }
    ULONG __stdcall AddRef() override {
        m_real->AddRef();
        return ++m_ref;
    }
    ULONG __stdcall Release() override {
        m_real->Release();
        const ULONG r = --m_ref;
        if (r == 0) delete this;
        return r;
    }

protected:
    Iface* m_real;
    std::atomic<ULONG> m_ref;
};

class Device9Proxy final : public Proxy<IDirect3DDevice9> {
public:
    using Proxy::Proxy;

    HRESULT __stdcall SetTransform(D3DTRANSFORMSTATETYPE state, const D3DMATRIX* m) override {
        if (state == D3DTS_VIEW && m && vireio_ht::pose().active.load(std::memory_order_relaxed)) {
            D3DMATRIX adjusted = *m;
            vireio_ht::apply_headpose_to_view(adjusted);
            return m_real->SetTransform(state, &adjusted);
        }
        return m_real->SetTransform(state, m);
    }

    // ── Every other IDirect3DDevice9 method just forwards ────────────
    // (Generated mechanically; not interesting — only SetTransform matters
    // for the proxy's job. Keeping these inline because IDirect3DDevice9
    // has ~100 methods and listing them is exhaustive but mechanical.)
    HRESULT __stdcall TestCooperativeLevel() override { return m_real->TestCooperativeLevel(); }
    UINT    __stdcall GetAvailableTextureMem() override { return m_real->GetAvailableTextureMem(); }
    HRESULT __stdcall EvictManagedResources() override { return m_real->EvictManagedResources(); }
    HRESULT __stdcall GetDirect3D(IDirect3D9** ppD3D9) override { return m_real->GetDirect3D(ppD3D9); }
    HRESULT __stdcall GetDeviceCaps(D3DCAPS9* p) override { return m_real->GetDeviceCaps(p); }
    HRESULT __stdcall GetDisplayMode(UINT s, D3DDISPLAYMODE* p) override { return m_real->GetDisplayMode(s, p); }
    HRESULT __stdcall GetCreationParameters(D3DDEVICE_CREATION_PARAMETERS* p) override { return m_real->GetCreationParameters(p); }
    HRESULT __stdcall SetCursorProperties(UINT x, UINT y, IDirect3DSurface9* s) override { return m_real->SetCursorProperties(x, y, s); }
    void    __stdcall SetCursorPosition(int x, int y, DWORD f) override { m_real->SetCursorPosition(x, y, f); }
    BOOL    __stdcall ShowCursor(BOOL b) override { return m_real->ShowCursor(b); }
    HRESULT __stdcall CreateAdditionalSwapChain(D3DPRESENT_PARAMETERS* p, IDirect3DSwapChain9** s) override { return m_real->CreateAdditionalSwapChain(p, s); }
    HRESULT __stdcall GetSwapChain(UINT i, IDirect3DSwapChain9** s) override { return m_real->GetSwapChain(i, s); }
    UINT    __stdcall GetNumberOfSwapChains() override { return m_real->GetNumberOfSwapChains(); }
    HRESULT __stdcall Reset(D3DPRESENT_PARAMETERS* p) override { return m_real->Reset(p); }
    HRESULT __stdcall Present(const RECT* a, const RECT* b, HWND h, const RGNDATA* d) override { return m_real->Present(a, b, h, d); }
    HRESULT __stdcall GetBackBuffer(UINT a, UINT b, D3DBACKBUFFER_TYPE t, IDirect3DSurface9** s) override { return m_real->GetBackBuffer(a, b, t, s); }
    HRESULT __stdcall GetRasterStatus(UINT i, D3DRASTER_STATUS* s) override { return m_real->GetRasterStatus(i, s); }
    HRESULT __stdcall SetDialogBoxMode(BOOL b) override { return m_real->SetDialogBoxMode(b); }
    void    __stdcall SetGammaRamp(UINT a, DWORD b, const D3DGAMMARAMP* g) override { m_real->SetGammaRamp(a, b, g); }
    void    __stdcall GetGammaRamp(UINT a, D3DGAMMARAMP* g) override { m_real->GetGammaRamp(a, g); }
    HRESULT __stdcall CreateTexture(UINT a, UINT b, UINT c, DWORD d, D3DFORMAT e, D3DPOOL f, IDirect3DTexture9** g, HANDLE* h) override { return m_real->CreateTexture(a, b, c, d, e, f, g, h); }
    HRESULT __stdcall CreateVolumeTexture(UINT a, UINT b, UINT c, UINT d, DWORD e, D3DFORMAT f, D3DPOOL g, IDirect3DVolumeTexture9** h, HANDLE* i) override { return m_real->CreateVolumeTexture(a, b, c, d, e, f, g, h, i); }
    HRESULT __stdcall CreateCubeTexture(UINT a, UINT b, DWORD c, D3DFORMAT d, D3DPOOL e, IDirect3DCubeTexture9** f, HANDLE* g) override { return m_real->CreateCubeTexture(a, b, c, d, e, f, g); }
    HRESULT __stdcall CreateVertexBuffer(UINT a, DWORD b, DWORD c, D3DPOOL d, IDirect3DVertexBuffer9** e, HANDLE* f) override { return m_real->CreateVertexBuffer(a, b, c, d, e, f); }
    HRESULT __stdcall CreateIndexBuffer(UINT a, DWORD b, D3DFORMAT c, D3DPOOL d, IDirect3DIndexBuffer9** e, HANDLE* f) override { return m_real->CreateIndexBuffer(a, b, c, d, e, f); }
    HRESULT __stdcall CreateRenderTarget(UINT a, UINT b, D3DFORMAT c, D3DMULTISAMPLE_TYPE d, DWORD e, BOOL f, IDirect3DSurface9** g, HANDLE* h) override { return m_real->CreateRenderTarget(a, b, c, d, e, f, g, h); }
    HRESULT __stdcall CreateDepthStencilSurface(UINT a, UINT b, D3DFORMAT c, D3DMULTISAMPLE_TYPE d, DWORD e, BOOL f, IDirect3DSurface9** g, HANDLE* h) override { return m_real->CreateDepthStencilSurface(a, b, c, d, e, f, g, h); }
    HRESULT __stdcall UpdateSurface(IDirect3DSurface9* a, const RECT* b, IDirect3DSurface9* c, const POINT* d) override { return m_real->UpdateSurface(a, b, c, d); }
    HRESULT __stdcall UpdateTexture(IDirect3DBaseTexture9* a, IDirect3DBaseTexture9* b) override { return m_real->UpdateTexture(a, b); }
    HRESULT __stdcall GetRenderTargetData(IDirect3DSurface9* a, IDirect3DSurface9* b) override { return m_real->GetRenderTargetData(a, b); }
    HRESULT __stdcall GetFrontBufferData(UINT a, IDirect3DSurface9* b) override { return m_real->GetFrontBufferData(a, b); }
    HRESULT __stdcall StretchRect(IDirect3DSurface9* a, const RECT* b, IDirect3DSurface9* c, const RECT* d, D3DTEXTUREFILTERTYPE e) override { return m_real->StretchRect(a, b, c, d, e); }
    HRESULT __stdcall ColorFill(IDirect3DSurface9* a, const RECT* b, D3DCOLOR c) override { return m_real->ColorFill(a, b, c); }
    HRESULT __stdcall CreateOffscreenPlainSurface(UINT a, UINT b, D3DFORMAT c, D3DPOOL d, IDirect3DSurface9** e, HANDLE* f) override { return m_real->CreateOffscreenPlainSurface(a, b, c, d, e, f); }
    HRESULT __stdcall SetRenderTarget(DWORD a, IDirect3DSurface9* b) override { return m_real->SetRenderTarget(a, b); }
    HRESULT __stdcall GetRenderTarget(DWORD a, IDirect3DSurface9** b) override { return m_real->GetRenderTarget(a, b); }
    HRESULT __stdcall SetDepthStencilSurface(IDirect3DSurface9* a) override { return m_real->SetDepthStencilSurface(a); }
    HRESULT __stdcall GetDepthStencilSurface(IDirect3DSurface9** a) override { return m_real->GetDepthStencilSurface(a); }
    HRESULT __stdcall BeginScene() override { return m_real->BeginScene(); }
    HRESULT __stdcall EndScene() override { return m_real->EndScene(); }
    HRESULT __stdcall Clear(DWORD a, const D3DRECT* b, DWORD c, D3DCOLOR d, float e, DWORD f) override { return m_real->Clear(a, b, c, d, e, f); }
    HRESULT __stdcall MultiplyTransform(D3DTRANSFORMSTATETYPE a, const D3DMATRIX* b) override { return m_real->MultiplyTransform(a, b); }
    HRESULT __stdcall GetTransform(D3DTRANSFORMSTATETYPE a, D3DMATRIX* b) override { return m_real->GetTransform(a, b); }
    HRESULT __stdcall SetViewport(const D3DVIEWPORT9* a) override { return m_real->SetViewport(a); }
    HRESULT __stdcall GetViewport(D3DVIEWPORT9* a) override { return m_real->GetViewport(a); }
    HRESULT __stdcall SetMaterial(const D3DMATERIAL9* a) override { return m_real->SetMaterial(a); }
    HRESULT __stdcall GetMaterial(D3DMATERIAL9* a) override { return m_real->GetMaterial(a); }
    HRESULT __stdcall SetLight(DWORD a, const D3DLIGHT9* b) override { return m_real->SetLight(a, b); }
    HRESULT __stdcall GetLight(DWORD a, D3DLIGHT9* b) override { return m_real->GetLight(a, b); }
    HRESULT __stdcall LightEnable(DWORD a, BOOL b) override { return m_real->LightEnable(a, b); }
    HRESULT __stdcall GetLightEnable(DWORD a, BOOL* b) override { return m_real->GetLightEnable(a, b); }
    HRESULT __stdcall SetClipPlane(DWORD a, const float* b) override { return m_real->SetClipPlane(a, b); }
    HRESULT __stdcall GetClipPlane(DWORD a, float* b) override { return m_real->GetClipPlane(a, b); }
    HRESULT __stdcall SetRenderState(D3DRENDERSTATETYPE a, DWORD b) override { return m_real->SetRenderState(a, b); }
    HRESULT __stdcall GetRenderState(D3DRENDERSTATETYPE a, DWORD* b) override { return m_real->GetRenderState(a, b); }
    HRESULT __stdcall CreateStateBlock(D3DSTATEBLOCKTYPE a, IDirect3DStateBlock9** b) override { return m_real->CreateStateBlock(a, b); }
    HRESULT __stdcall BeginStateBlock() override { return m_real->BeginStateBlock(); }
    HRESULT __stdcall EndStateBlock(IDirect3DStateBlock9** a) override { return m_real->EndStateBlock(a); }
    HRESULT __stdcall SetClipStatus(const D3DCLIPSTATUS9* a) override { return m_real->SetClipStatus(a); }
    HRESULT __stdcall GetClipStatus(D3DCLIPSTATUS9* a) override { return m_real->GetClipStatus(a); }
    HRESULT __stdcall GetTexture(DWORD a, IDirect3DBaseTexture9** b) override { return m_real->GetTexture(a, b); }
    HRESULT __stdcall SetTexture(DWORD a, IDirect3DBaseTexture9* b) override { return m_real->SetTexture(a, b); }
    HRESULT __stdcall GetTextureStageState(DWORD a, D3DTEXTURESTAGESTATETYPE b, DWORD* c) override { return m_real->GetTextureStageState(a, b, c); }
    HRESULT __stdcall SetTextureStageState(DWORD a, D3DTEXTURESTAGESTATETYPE b, DWORD c) override { return m_real->SetTextureStageState(a, b, c); }
    HRESULT __stdcall GetSamplerState(DWORD a, D3DSAMPLERSTATETYPE b, DWORD* c) override { return m_real->GetSamplerState(a, b, c); }
    HRESULT __stdcall SetSamplerState(DWORD a, D3DSAMPLERSTATETYPE b, DWORD c) override { return m_real->SetSamplerState(a, b, c); }
    HRESULT __stdcall ValidateDevice(DWORD* a) override { return m_real->ValidateDevice(a); }
    HRESULT __stdcall SetPaletteEntries(UINT a, const PALETTEENTRY* b) override { return m_real->SetPaletteEntries(a, b); }
    HRESULT __stdcall GetPaletteEntries(UINT a, PALETTEENTRY* b) override { return m_real->GetPaletteEntries(a, b); }
    HRESULT __stdcall SetCurrentTexturePalette(UINT a) override { return m_real->SetCurrentTexturePalette(a); }
    HRESULT __stdcall GetCurrentTexturePalette(UINT* a) override { return m_real->GetCurrentTexturePalette(a); }
    HRESULT __stdcall SetScissorRect(const RECT* a) override { return m_real->SetScissorRect(a); }
    HRESULT __stdcall GetScissorRect(RECT* a) override { return m_real->GetScissorRect(a); }
    HRESULT __stdcall SetSoftwareVertexProcessing(BOOL a) override { return m_real->SetSoftwareVertexProcessing(a); }
    BOOL    __stdcall GetSoftwareVertexProcessing() override { return m_real->GetSoftwareVertexProcessing(); }
    HRESULT __stdcall SetNPatchMode(float a) override { return m_real->SetNPatchMode(a); }
    float   __stdcall GetNPatchMode() override { return m_real->GetNPatchMode(); }
    HRESULT __stdcall DrawPrimitive(D3DPRIMITIVETYPE a, UINT b, UINT c) override { return m_real->DrawPrimitive(a, b, c); }
    HRESULT __stdcall DrawIndexedPrimitive(D3DPRIMITIVETYPE a, INT b, UINT c, UINT d, UINT e, UINT f) override { return m_real->DrawIndexedPrimitive(a, b, c, d, e, f); }
    HRESULT __stdcall DrawPrimitiveUP(D3DPRIMITIVETYPE a, UINT b, const void* c, UINT d) override { return m_real->DrawPrimitiveUP(a, b, c, d); }
    HRESULT __stdcall DrawIndexedPrimitiveUP(D3DPRIMITIVETYPE a, UINT b, UINT c, UINT d, const void* e, D3DFORMAT f, const void* g, UINT h) override { return m_real->DrawIndexedPrimitiveUP(a, b, c, d, e, f, g, h); }
    HRESULT __stdcall ProcessVertices(UINT a, UINT b, UINT c, IDirect3DVertexBuffer9* d, IDirect3DVertexDeclaration9* e, DWORD f) override { return m_real->ProcessVertices(a, b, c, d, e, f); }
    HRESULT __stdcall CreateVertexDeclaration(const D3DVERTEXELEMENT9* a, IDirect3DVertexDeclaration9** b) override { return m_real->CreateVertexDeclaration(a, b); }
    HRESULT __stdcall SetVertexDeclaration(IDirect3DVertexDeclaration9* a) override { return m_real->SetVertexDeclaration(a); }
    HRESULT __stdcall GetVertexDeclaration(IDirect3DVertexDeclaration9** a) override { return m_real->GetVertexDeclaration(a); }
    HRESULT __stdcall SetFVF(DWORD a) override { return m_real->SetFVF(a); }
    HRESULT __stdcall GetFVF(DWORD* a) override { return m_real->GetFVF(a); }
    HRESULT __stdcall CreateVertexShader(const DWORD* a, IDirect3DVertexShader9** b) override { return m_real->CreateVertexShader(a, b); }
    HRESULT __stdcall SetVertexShader(IDirect3DVertexShader9* a) override { return m_real->SetVertexShader(a); }
    HRESULT __stdcall GetVertexShader(IDirect3DVertexShader9** a) override { return m_real->GetVertexShader(a); }
    HRESULT __stdcall SetVertexShaderConstantF(UINT a, const float* b, UINT c) override { return m_real->SetVertexShaderConstantF(a, b, c); }
    HRESULT __stdcall GetVertexShaderConstantF(UINT a, float* b, UINT c) override { return m_real->GetVertexShaderConstantF(a, b, c); }
    HRESULT __stdcall SetVertexShaderConstantI(UINT a, const int* b, UINT c) override { return m_real->SetVertexShaderConstantI(a, b, c); }
    HRESULT __stdcall GetVertexShaderConstantI(UINT a, int* b, UINT c) override { return m_real->GetVertexShaderConstantI(a, b, c); }
    HRESULT __stdcall SetVertexShaderConstantB(UINT a, const BOOL* b, UINT c) override { return m_real->SetVertexShaderConstantB(a, b, c); }
    HRESULT __stdcall GetVertexShaderConstantB(UINT a, BOOL* b, UINT c) override { return m_real->GetVertexShaderConstantB(a, b, c); }
    HRESULT __stdcall SetStreamSource(UINT a, IDirect3DVertexBuffer9* b, UINT c, UINT d) override { return m_real->SetStreamSource(a, b, c, d); }
    HRESULT __stdcall GetStreamSource(UINT a, IDirect3DVertexBuffer9** b, UINT* c, UINT* d) override { return m_real->GetStreamSource(a, b, c, d); }
    HRESULT __stdcall SetStreamSourceFreq(UINT a, UINT b) override { return m_real->SetStreamSourceFreq(a, b); }
    HRESULT __stdcall GetStreamSourceFreq(UINT a, UINT* b) override { return m_real->GetStreamSourceFreq(a, b); }
    HRESULT __stdcall SetIndices(IDirect3DIndexBuffer9* a) override { return m_real->SetIndices(a); }
    HRESULT __stdcall GetIndices(IDirect3DIndexBuffer9** a) override { return m_real->GetIndices(a); }
    HRESULT __stdcall CreatePixelShader(const DWORD* a, IDirect3DPixelShader9** b) override { return m_real->CreatePixelShader(a, b); }
    HRESULT __stdcall SetPixelShader(IDirect3DPixelShader9* a) override { return m_real->SetPixelShader(a); }
    HRESULT __stdcall GetPixelShader(IDirect3DPixelShader9** a) override { return m_real->GetPixelShader(a); }
    HRESULT __stdcall SetPixelShaderConstantF(UINT a, const float* b, UINT c) override { return m_real->SetPixelShaderConstantF(a, b, c); }
    HRESULT __stdcall GetPixelShaderConstantF(UINT a, float* b, UINT c) override { return m_real->GetPixelShaderConstantF(a, b, c); }
    HRESULT __stdcall SetPixelShaderConstantI(UINT a, const int* b, UINT c) override { return m_real->SetPixelShaderConstantI(a, b, c); }
    HRESULT __stdcall GetPixelShaderConstantI(UINT a, int* b, UINT c) override { return m_real->GetPixelShaderConstantI(a, b, c); }
    HRESULT __stdcall SetPixelShaderConstantB(UINT a, const BOOL* b, UINT c) override { return m_real->SetPixelShaderConstantB(a, b, c); }
    HRESULT __stdcall GetPixelShaderConstantB(UINT a, BOOL* b, UINT c) override { return m_real->GetPixelShaderConstantB(a, b, c); }
    HRESULT __stdcall DrawRectPatch(UINT a, const float* b, const D3DRECTPATCH_INFO* c) override { return m_real->DrawRectPatch(a, b, c); }
    HRESULT __stdcall DrawTriPatch(UINT a, const float* b, const D3DTRIPATCH_INFO* c) override { return m_real->DrawTriPatch(a, b, c); }
    HRESULT __stdcall DeletePatch(UINT a) override { return m_real->DeletePatch(a); }
    HRESULT __stdcall CreateQuery(D3DQUERYTYPE a, IDirect3DQuery9** b) override { return m_real->CreateQuery(a, b); }
};

class D3D9Proxy final : public Proxy<IDirect3D9> {
public:
    using Proxy::Proxy;

    HRESULT __stdcall CreateDevice(UINT adapter, D3DDEVTYPE devType, HWND hwnd, DWORD bflags, D3DPRESENT_PARAMETERS* pp, IDirect3DDevice9** ppDev) override {
        IDirect3DDevice9* real = nullptr;
        HRESULT hr = m_real->CreateDevice(adapter, devType, hwnd, bflags, pp, &real);
        if (FAILED(hr) || !real) { if (ppDev) *ppDev = nullptr; return hr; }
        if (ppDev) *ppDev = new Device9Proxy(real);
        return S_OK;
    }

    HRESULT __stdcall RegisterSoftwareDevice(void* p) override { return m_real->RegisterSoftwareDevice(p); }
    UINT    __stdcall GetAdapterCount() override { return m_real->GetAdapterCount(); }
    HRESULT __stdcall GetAdapterIdentifier(UINT a, DWORD b, D3DADAPTER_IDENTIFIER9* c) override { return m_real->GetAdapterIdentifier(a, b, c); }
    UINT    __stdcall GetAdapterModeCount(UINT a, D3DFORMAT b) override { return m_real->GetAdapterModeCount(a, b); }
    HRESULT __stdcall EnumAdapterModes(UINT a, D3DFORMAT b, UINT c, D3DDISPLAYMODE* d) override { return m_real->EnumAdapterModes(a, b, c, d); }
    HRESULT __stdcall GetAdapterDisplayMode(UINT a, D3DDISPLAYMODE* b) override { return m_real->GetAdapterDisplayMode(a, b); }
    HRESULT __stdcall CheckDeviceType(UINT a, D3DDEVTYPE b, D3DFORMAT c, D3DFORMAT d, BOOL e) override { return m_real->CheckDeviceType(a, b, c, d, e); }
    HRESULT __stdcall CheckDeviceFormat(UINT a, D3DDEVTYPE b, D3DFORMAT c, DWORD d, D3DRESOURCETYPE e, D3DFORMAT f) override { return m_real->CheckDeviceFormat(a, b, c, d, e, f); }
    HRESULT __stdcall CheckDeviceMultiSampleType(UINT a, D3DDEVTYPE b, D3DFORMAT c, BOOL d, D3DMULTISAMPLE_TYPE e, DWORD* f) override { return m_real->CheckDeviceMultiSampleType(a, b, c, d, e, f); }
    HRESULT __stdcall CheckDepthStencilMatch(UINT a, D3DDEVTYPE b, D3DFORMAT c, D3DFORMAT d, D3DFORMAT e) override { return m_real->CheckDepthStencilMatch(a, b, c, d, e); }
    HRESULT __stdcall CheckDeviceFormatConversion(UINT a, D3DDEVTYPE b, D3DFORMAT c, D3DFORMAT d) override { return m_real->CheckDeviceFormatConversion(a, b, c, d); }
    HRESULT __stdcall GetDeviceCaps(UINT a, D3DDEVTYPE b, D3DCAPS9* c) override { return m_real->GetDeviceCaps(a, b, c); }
    HMONITOR __stdcall GetAdapterMonitor(UINT a) override { return m_real->GetAdapterMonitor(a); }
};

}  // namespace

IDirect3D9*   create_d3d9_proxy(IDirect3D9*   real) { return new D3D9Proxy(real); }
// Ex variant: not yet wrapped — most games using d3d9.dll fall back to the
// non-Ex path. Returning the raw object means SetTransform interception is
// skipped for true-Ex flows; that's a follow-up.
IDirect3D9Ex* create_d3d9ex_proxy(IDirect3D9Ex* real) { return real; }
