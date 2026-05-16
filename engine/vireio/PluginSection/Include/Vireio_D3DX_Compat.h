/********************************************************************
Vireio Perception: Open-Source Stereoscopic 3D Driver

File <Vireio_D3DX_Compat.h> :
Compatibility shim aliasing legacy D3DX (June-2010 DirectX SDK)
types onto modern DirectXMath storage types from the Windows SDK.

This header is part of the v4 modernization removing the deprecated
June-2010 DirectX SDK dependency. It provides TYPE aliases only —
D3DX free functions (D3DXMatrixMultiply, D3DXVec3Normalize, ...)
are NOT aliased and must be ported per call-site to DirectXMath
idioms (XMLoad* / XM... / XMStore*).

Binary layout note: D3DXMATRIX, D3DXVECTOR{2,3,4}, D3DXCOLOR are all
storage-shaped POD types matching DirectX::XMFLOAT{4X4,2,3,4} exactly
(row-major 16/2/3/4 floats). They can safely be cast or aliased for
ABI-compatible passing across plugin boundaries.

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

// Pull D3D9 (provides D3DMATRIX, IDirect3DSurface9, etc.) so call sites that include
// this header don't need to remember to include <d3d9.h> first.
#ifndef _D3D9_H_
#include <d3d9.h>
#pragma comment(lib, "d3d9.lib")
#endif

// Pull D3D10.1 + D3D11 too — our compat shims reference symbols from both
// (common shader slot counts, etc.). Include d3d10_1.h to satisfy projects that
// target the .1 interface; it pulls d3d10.h in the correct order internally.
#ifndef __d3d10_1_h__
#include <d3d10_1.h>
#endif
#ifndef __d3d11_h__
#include <d3d11.h>
#endif
// D3D10 effects framework — modern Windows 10 SDK ships the state-block API
// (D3D10_STATE_BLOCK_MASK, ID3D10StateBlock, D3D10CreateStateBlock,
// D3D10StateBlockMaskEnableAll) here, replacing the legacy d3dx10async.h.
#ifndef __d3d10effect_h__
#include <d3d10effect.h>
#endif
// d3dcompiler.h provides D3DCompile (modern replacement for D3DXCompileShader).
#ifndef __D3DCOMPILER_H__
#include <d3dcompiler.h>
#pragma comment(lib, "d3dcompiler.lib")
#endif
#include <vector>
#include <cstring>

#include <DirectXMath.h>
#include <DirectXPackedVector.h>

// Storage-shape type aliases.
// All of these have identical memory layout to the original D3DX types
// (verified: D3DXMATRIX = 16 floats row-major; D3DXVECTORn = n floats;
// D3DXCOLOR = {r,g,b,a} floats; D3DXQUATERNION = {x,y,z,w} floats).
typedef DirectX::XMFLOAT2     D3DXVECTOR2;
typedef DirectX::XMFLOAT3     D3DXVECTOR3;
typedef DirectX::XMFLOAT4     D3DXVECTOR4;
typedef DirectX::XMFLOAT4     D3DXQUATERNION;
typedef DirectX::XMFLOAT4     D3DXPLANE;

// D3DXMATRIX wears two hats in the original D3DX SDK:
//   1. It IS-A D3DMATRIX (inherits) so D3DXMATRIX* trivially passes where D3DMATRIX*
//      is expected (Direct3D9 SetTransform, etc.).
//   2. It implicitly converts to float* / const float* for raw pointer math.
// We reproduce both — the binary layout is identical to D3DMATRIX and XMFLOAT4X4
// (16 row-major floats, 64 bytes), and we additionally inherit XMFLOAT4X4 so
// XMStoreFloat4x4(&d3dxmat, ...) and friends accept a D3DXMATRIX* directly.
struct D3DXMATRIX : public DirectX::XMFLOAT4X4
{
    D3DXMATRIX() noexcept = default;
    D3DXMATRIX(const D3DXMATRIX&) noexcept = default;
    D3DXMATRIX& operator=(const D3DXMATRIX&) noexcept = default;

    D3DXMATRIX(float f11, float f12, float f13, float f14,
               float f21, float f22, float f23, float f24,
               float f31, float f32, float f33, float f34,
               float f41, float f42, float f43, float f44) noexcept
        : DirectX::XMFLOAT4X4(f11, f12, f13, f14, f21, f22, f23, f24, f31, f32, f33, f34, f41, f42, f43, f44) {}

    explicit D3DXMATRIX(const float* p) noexcept
        : DirectX::XMFLOAT4X4(p) {}

    // Legacy: D3DXMATRIX(REGISTER4F) / D3DXMATRIX(XMFLOAT4) — reinterprets the
    // vector address as the start of a 16-float matrix (matches old D3DX behaviour
    // where REGISTER4F was D3DXVECTOR4 and decayed to float* via operator FLOAT*).
    explicit D3DXMATRIX(const DirectX::XMFLOAT4& v) noexcept
        : DirectX::XMFLOAT4X4(reinterpret_cast<const float*>(&v)) {}

    D3DXMATRIX(const D3DMATRIX& m) noexcept
    {
        *reinterpret_cast<D3DMATRIX*>(this) = m;
    }

    D3DXMATRIX(const DirectX::XMFLOAT4X4& m) noexcept : DirectX::XMFLOAT4X4(m) {}

    // Implicit decay to D3DMATRIX — matches the legacy "inherits from D3DMATRIX" behaviour.
    // Reference form so existing `&d3dxMat` keeps yielding D3DMATRIX* when needed via cast.
    operator D3DMATRIX&() noexcept             { return *reinterpret_cast<D3DMATRIX*>(this); }
    operator const D3DMATRIX&() const noexcept { return *reinterpret_cast<const D3DMATRIX*>(this); }
    // By-value form for function-style casts: `(D3DMATRIX)d3dxMat`.
    operator D3DMATRIX() const noexcept        { return *reinterpret_cast<const D3DMATRIX*>(this); }

    // Implicit decay to raw float pointer (legacy D3DXMATRIX::operator FLOAT*).
    operator float*() noexcept             { return &_11; }
    operator const float*() const noexcept { return &_11; }

    // Element access via (row, col), 0-indexed — matches D3DXMATRIX::operator().
    float& operator()(unsigned r, unsigned c) noexcept             { return m[r][c]; }
    float  operator()(unsigned r, unsigned c) const noexcept       { return m[r][c]; }
};
static_assert(sizeof(D3DXMATRIX) == sizeof(float) * 16, "D3DXMATRIX must remain 64 bytes for ABI compatibility");

typedef D3DXMATRIX D3DXMATRIXA16; // legacy 16-byte-aligned variant; we drop the alignment requirement (no current call site relies on it)

// D3DXCOLOR is the one D3DX storage type that exposes named r/g/b/a members
// and constructs from a packed ARGB DWORD (D3DCOLOR). XMFLOAT4 has x/y/z/w only,
// so we redefine D3DXCOLOR as a thin struct with the same binary layout (16 bytes,
// 4 floats r,g,b,a) and the conversions the legacy code relies on.
struct D3DXCOLOR
{
    float r, g, b, a;

    D3DXCOLOR() noexcept : r(0), g(0), b(0), a(0) {}
    D3DXCOLOR(float _r, float _g, float _b, float _a) noexcept : r(_r), g(_g), b(_b), a(_a) {}
    D3DXCOLOR(DWORD argb) noexcept
        : r(((argb >> 16) & 0xFF) / 255.0f)
        , g(((argb >>  8) & 0xFF) / 255.0f)
        , b(((argb >>  0) & 0xFF) / 255.0f)
        , a(((argb >> 24) & 0xFF) / 255.0f) {}
    D3DXCOLOR(const float* p) noexcept : r(p[0]), g(p[1]), b(p[2]), a(p[3]) {}

    // Conversion to/from packed DWORD (matches legacy D3DXCOLOR behaviour).
    operator DWORD() const noexcept
    {
        auto clamp = [](float v) { return v < 0 ? 0u : (v > 1 ? 255u : DWORD(v * 255.0f + 0.5f)); };
        return (clamp(a) << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
    }

    // Conversion to XMFLOAT4 for math interop.
    operator DirectX::XMFLOAT4() const noexcept { return DirectX::XMFLOAT4(r, g, b, a); }
};
static_assert(sizeof(D3DXCOLOR) == sizeof(float) * 4, "D3DXCOLOR must remain 16 bytes for ABI compatibility");

// D3DX surface/volume helper constants and types from d3dx9tex.h.
#ifndef D3DX_DEFAULT
#define D3DX_DEFAULT ((UINT)-1)
#endif
#ifndef D3DX_DEFAULT_NONPOW2
#define D3DX_DEFAULT_NONPOW2 ((UINT)-2)
#endif
#ifndef D3DX_FROM_FILE
#define D3DX_FROM_FILE ((UINT)-3)
#endif
#ifndef D3DFMT_FROM_FILE
#define D3DFMT_FROM_FILE ((D3DFORMAT)-3)
#endif
#ifndef D3DX_FILTER_NONE
#define D3DX_FILTER_NONE       (1 <<  0)
#define D3DX_FILTER_POINT      (2 <<  0)
#define D3DX_FILTER_LINEAR     (3 <<  0)
#define D3DX_FILTER_TRIANGLE   (4 <<  0)
#define D3DX_FILTER_BOX        (5 <<  0)
#define D3DX_FILTER_MIRROR_U   (1 << 16)
#define D3DX_FILTER_MIRROR_V   (2 << 16)
#define D3DX_FILTER_MIRROR_W   (4 << 16)
#define D3DX_FILTER_MIRROR     (7 << 16)
#define D3DX_FILTER_DITHER     (1 << 19)
#define D3DX_FILTER_SRGB_IN    (1 << 21)
#define D3DX_FILTER_SRGB_OUT   (2 << 21)
#define D3DX_FILTER_SRGB       (3 << 21)
#endif

// Fill callback types (originally LPD3DXFILL2D / LPD3DXFILL3D).
typedef VOID (WINAPI* LPD3DXFILL2D)(D3DXVECTOR4* pOut, const D3DXVECTOR2* pTexCoord, const D3DXVECTOR2* pTexelSize, LPVOID pData);
typedef VOID (WINAPI* LPD3DXFILL3D)(D3DXVECTOR4* pOut, const D3DXVECTOR3* pTexCoord, const D3DXVECTOR3* pTexelSize, LPVOID pData);

// Minimal D3DXLoadSurfaceFromSurface replacement.
// Common cases here (full-surface, same-format) reduce to UpdateSurface or a manual
// Lock/memcpy roundtrip. The full D3DX behaviour (format conversion + filtering) is
// not preserved — Vireio's call sites all pass NULL rects, NULL palettes, no filter,
// and copy between matching SYSTEMMEM/DEFAULT scratch surfaces, so this is enough.
inline HRESULT D3DXLoadSurfaceFromSurface(IDirect3DSurface9* pDestSurface, const PALETTEENTRY* /*pDestPalette*/, const RECT* /*pDestRect*/,
                                          IDirect3DSurface9* pSrcSurface, const PALETTEENTRY* /*pSrcPalette*/, const RECT* /*pSrcRect*/,
                                          DWORD /*Filter*/, D3DCOLOR /*ColorKey*/) noexcept
{
    if (!pDestSurface || !pSrcSurface) return E_POINTER;

    IDirect3DDevice9* pcDevice = nullptr;
    if (FAILED(pDestSurface->GetDevice(&pcDevice)) || !pcDevice) return E_FAIL;

    // Try the cheap path: GPU-side update.
    HRESULT hr = pcDevice->UpdateSurface(pSrcSurface, nullptr, pDestSurface, nullptr);
    if (SUCCEEDED(hr)) { pcDevice->Release(); return hr; }

    // Fallback: lock/memcpy. Same format and size assumed.
    D3DSURFACE_DESC srcDesc, dstDesc;
    pSrcSurface->GetDesc(&srcDesc);
    pDestSurface->GetDesc(&dstDesc);
    if (srcDesc.Width != dstDesc.Width || srcDesc.Height != dstDesc.Height || srcDesc.Format != dstDesc.Format)
    {
        pcDevice->Release();
        return E_FAIL;
    }

    D3DLOCKED_RECT lrSrc{}, lrDst{};
    if (FAILED(pSrcSurface->LockRect(&lrSrc, nullptr, D3DLOCK_READONLY))) { pcDevice->Release(); return E_FAIL; }
    if (FAILED(pDestSurface->LockRect(&lrDst, nullptr, 0))) { pSrcSurface->UnlockRect(); pcDevice->Release(); return E_FAIL; }

    const SIZE_T rowBytes = (SIZE_T)lrSrc.Pitch < (SIZE_T)lrDst.Pitch ? lrSrc.Pitch : lrDst.Pitch;
    for (UINT row = 0; row < srcDesc.Height; ++row)
        memcpy((BYTE*)lrDst.pBits + row * lrDst.Pitch, (BYTE*)lrSrc.pBits + row * lrSrc.Pitch, rowBytes);

    pDestSurface->UnlockRect();
    pSrcSurface->UnlockRect();
    pcDevice->Release();
    return S_OK;
}

// Minimal D3DXLoadVolumeFromVolume replacement. Same caveats — no format conversion,
// just a same-format same-dimensions lock/memcpy.
inline HRESULT D3DXLoadVolumeFromVolume(IDirect3DVolume9* pDestVolume, const PALETTEENTRY* /*pDestPalette*/, const D3DBOX* /*pDestBox*/,
                                        IDirect3DVolume9* pSrcVolume, const PALETTEENTRY* /*pSrcPalette*/, const D3DBOX* /*pSrcBox*/,
                                        DWORD /*Filter*/, D3DCOLOR /*ColorKey*/) noexcept
{
    if (!pDestVolume || !pSrcVolume) return E_POINTER;

    D3DVOLUME_DESC srcDesc{}, dstDesc{};
    pSrcVolume->GetDesc(&srcDesc);
    pDestVolume->GetDesc(&dstDesc);
    if (srcDesc.Width != dstDesc.Width || srcDesc.Height != dstDesc.Height || srcDesc.Depth != dstDesc.Depth || srcDesc.Format != dstDesc.Format)
        return E_FAIL;

    D3DLOCKED_BOX lbSrc{}, lbDst{};
    if (FAILED(pSrcVolume->LockBox(&lbSrc, nullptr, D3DLOCK_READONLY))) return E_FAIL;
    if (FAILED(pDestVolume->LockBox(&lbDst, nullptr, 0))) { pSrcVolume->UnlockBox(); return E_FAIL; }

    const SIZE_T rowBytes = (SIZE_T)lbSrc.RowPitch < (SIZE_T)lbDst.RowPitch ? lbSrc.RowPitch : lbDst.RowPitch;
    for (UINT z = 0; z < srcDesc.Depth; ++z)
        for (UINT y = 0; y < srcDesc.Height; ++y)
            memcpy((BYTE*)lbDst.pBits + z * lbDst.SlicePitch + y * lbDst.RowPitch,
                   (BYTE*)lbSrc.pBits + z * lbSrc.SlicePitch + y * lbSrc.RowPitch, rowBytes);

    pDestVolume->UnlockBox();
    pSrcVolume->UnlockBox();
    return S_OK;
}

// D3DX9 shader compilation + reflection (originally d3dx9shader.h).
//
// Phase A.8 (post-A.7 modernization): the constant table now does REAL parsing
// of the CTAB blob embedded in D3D9 shader bytecode, restoring Vireio's
// D3D9 matrix-modification capability without the legacy d3dx9.lib. The shader
// compile shim routes through D3DCompile (modern, in Windows SDK).
typedef ID3DBlob*  LPD3DXBUFFER;
typedef LPCSTR     D3DXHANDLE;

struct D3DXCONSTANT_DESC
{
    LPCSTR                Name;
    enum _D3DXREGISTER_SET    RegisterSet;
    UINT                  RegisterIndex;
    UINT                  RegisterCount;
    enum _D3DXPARAMETER_CLASS Class;
    enum _D3DXPARAMETER_TYPE  Type;
    UINT                  Rows;
    UINT                  Columns;
    UINT                  Elements;
    UINT                  StructMembers;
    UINT                  Bytes;
    LPCVOID               DefaultValue;
};

struct D3DXCONSTANTTABLE_DESC
{
    LPCSTR Creator;
    DWORD  Version;
    UINT   Constants;
};

// ID3DXConstantTable — real D3D9 CTAB bytecode parser.
//
// Background: D3D9 vertex/pixel shaders embed a "constant table" (CTAB) in a
// D3DSIO_COMMENT (opcode 0xFFFE) token. The original D3DX9 library exposed it
// via ID3DXConstantTable; we re-implement the read side (parse, enumerate, look
// up by index) here against the documented CTAB layout. Vireio only uses the
// read side — SetFloatArray etc. remain no-ops.
//
// CTAB layout (all offsets relative to start of CTAB blob, little-endian):
//   header (28 bytes) — Size, Creator, Version, Constants, ConstantInfo, Flags, Target
//   ConstantInfo[Constants] — Name, RegisterSet, RegisterIndex, RegisterCount,
//                              Reserved, TypeInfo, DefaultValue (20 bytes each)
//   TypeInfo (16 bytes at TypeInfo offset) — Class, Type, Rows, Columns,
//                                            Elements, StructMembers, StructMemberInfo
//   String pool — null-terminated ASCII names referenced by Creator/Target/Name.
//
// Reference: Microsoft "DirectX 9 Shader Constant Table" documentation.
class ID3DXConstantTable
{
public:
    LONG _refs = 1;
    ULONG AddRef()  noexcept { return (ULONG)InterlockedIncrement(&_refs); }
    ULONG Release() noexcept { LONG r = InterlockedDecrement(&_refs); if (!r) delete this; return (ULONG)r; }

    // Parse a shader bytecode blob — returns true if a CTAB section was found.
    bool Parse(const DWORD* pBytecode) noexcept
    {
        if (!pBytecode) return false;
        const DWORD* p = pBytecode;
        // First DWORD is the version token (vs_x_x or ps_x_x); skip it.
        if ((*p & 0xFFFF0000) != 0xFFFE0000 && (*p & 0xFFFF0000) != 0xFFFF0000)
            ++p;

        // Walk tokens looking for a D3DSIO_COMMENT (low 16 bits = 0xFFFE) whose
        // first comment DWORD is "CTAB".
        constexpr DWORD D3DSIO_COMMENT = 0xFFFE;
        constexpr DWORD D3DSIO_END     = 0x0000FFFF;
        constexpr DWORD CTAB_MAGIC     = 0x42415443; // 'CTAB' little-endian
        while (*p != D3DSIO_END)
        {
            const DWORD token = *p;
            if ((token & 0xFFFF) == D3DSIO_COMMENT)
            {
                const DWORD commentLen = (token >> 16) & 0x7FFF; // # extra DWORDs
                if (commentLen >= 2 && p[1] == CTAB_MAGIC)
                {
                    // CTAB blob starts at p[2] (after the comment+magic header).
                    const size_t ctabBytes = (commentLen - 1) * sizeof(DWORD);
                    m_ctab.assign(reinterpret_cast<const BYTE*>(&p[2]),
                                  reinterpret_cast<const BYTE*>(&p[2]) + ctabBytes);
                    return ValidateHeader();
                }
                p += commentLen + 1;
            }
            else
            {
                // For non-comment tokens we must skip the right number of DWORDs.
                // Most instructions have their length in bits 24-27 (D3DSI_INSTLENGTH).
                const DWORD instLen = (token >> 24) & 0x0F;
                p += instLen + 1;
            }
            // Safety: avoid runaway if the bytecode is malformed.
            if (p - pBytecode > 1024 * 1024) return false;
        }
        return false;
    }

    HRESULT GetDesc(D3DXCONSTANTTABLE_DESC* pDesc) const noexcept
    {
        if (!pDesc) return E_POINTER;
        const Header* h = Hdr();
        if (!h) { pDesc->Creator = ""; pDesc->Version = 0; pDesc->Constants = 0; return E_FAIL; }
        pDesc->Creator   = h->Creator   ? Str(h->Creator) : "";
        pDesc->Version   = h->Version;
        pDesc->Constants = h->Constants;
        return S_OK;
    }

    // Top-level constant by index. We encode the handle as a pointer to the
    // constant_info entry inside the CTAB blob.
    D3DXHANDLE GetConstant(D3DXHANDLE /*hParent*/, UINT Index) const noexcept
    {
        const Header* h = Hdr();
        if (!h || Index >= h->Constants) return nullptr;
        const ConstantInfo* ci = ConstantInfoArr() + Index;
        return reinterpret_cast<D3DXHANDLE>(ci);
    }

    D3DXHANDLE GetConstantByName(D3DXHANDLE /*hParent*/, LPCSTR pName) const noexcept
    {
        const Header* h = Hdr();
        if (!h || !pName) return nullptr;
        const ConstantInfo* arr = ConstantInfoArr();
        for (DWORD i = 0; i < h->Constants; ++i)
        {
            LPCSTR name = Str(arr[i].Name);
            if (name && strcmp(name, pName) == 0)
                return reinterpret_cast<D3DXHANDLE>(&arr[i]);
        }
        return nullptr;
    }

    HRESULT GetConstantDesc(D3DXHANDLE hConstant, D3DXCONSTANT_DESC* pDesc, UINT* pCount) const noexcept
    {
        if (pCount) *pCount = 0;
        if (!pDesc || !hConstant) return E_INVALIDARG;
        const ConstantInfo* ci = reinterpret_cast<const ConstantInfo*>(hConstant);
        if (!Contains(ci)) return E_INVALIDARG;

        const TypeInfo* ti = reinterpret_cast<const TypeInfo*>(m_ctab.data() + ci->TypeInfo);
        if (!ContainsBytes(ti, sizeof(TypeInfo))) return E_FAIL;

        pDesc->Name          = Str(ci->Name);
        pDesc->RegisterSet   = (_D3DXREGISTER_SET)ci->RegisterSet;
        pDesc->RegisterIndex = ci->RegisterIndex;
        pDesc->RegisterCount = ci->RegisterCount;
        pDesc->Class         = (_D3DXPARAMETER_CLASS)ti->Class;
        pDesc->Type          = (_D3DXPARAMETER_TYPE)ti->Type;
        pDesc->Rows          = ti->Rows;
        pDesc->Columns       = ti->Columns;
        pDesc->Elements      = ti->Elements;
        pDesc->StructMembers = ti->StructMembers;
        pDesc->Bytes         = ci->RegisterCount * 16; // 4 floats per register
        pDesc->DefaultValue  = ci->DefaultValue ? (m_ctab.data() + ci->DefaultValue) : nullptr;

        if (pCount) *pCount = 1;
        return S_OK;
    }

    // Write-side stubs — Vireio's reflection path never calls these. Kept for
    // demo nodes / Aquilinus.cpp which capture-then-discard a constant table.
    HRESULT SetFloatArray(IDirect3DDevice9*, D3DXHANDLE, const FLOAT*, UINT) noexcept { return S_OK; }
    HRESULT SetVectorArray(IDirect3DDevice9*, D3DXHANDLE, const D3DXVECTOR4*, UINT) noexcept { return S_OK; }
    HRESULT SetMatrixArray(IDirect3DDevice9*, D3DXHANDLE, const D3DXMATRIX*, UINT) noexcept { return S_OK; }
    LPVOID  GetBufferPointer() noexcept { return m_ctab.empty() ? nullptr : m_ctab.data(); }
    DWORD   GetBufferSize()    noexcept { return (DWORD)m_ctab.size(); }

private:
    // CTAB layout structs — packed, little-endian, matching the binary format.
#pragma pack(push, 1)
    struct Header {
        DWORD Size;          // header byte-size (28)
        DWORD Creator;       // offset to creator string
        DWORD Version;       // shader version (e.g. 0xFFFE0200 for vs_2_0)
        DWORD Constants;     // # of top-level constants
        DWORD ConstantInfo;  // offset to ConstantInfo[Constants]
        DWORD Flags;
        DWORD Target;        // offset to target string
    };
    struct ConstantInfo {
        DWORD Name;          // offset to name string
        WORD  RegisterSet;   // D3DXREGISTER_SET
        WORD  RegisterIndex;
        WORD  RegisterCount;
        WORD  Reserved;
        DWORD TypeInfo;      // offset to TypeInfo
        DWORD DefaultValue;  // offset to default-value blob (or 0)
    };
    struct TypeInfo {
        WORD  Class;          // D3DXPARAMETER_CLASS
        WORD  Type;           // D3DXPARAMETER_TYPE
        WORD  Rows;
        WORD  Columns;
        WORD  Elements;
        WORD  StructMembers;
        DWORD StructMemberInfo;
    };
#pragma pack(pop)

    bool ValidateHeader() const noexcept
    {
        if (m_ctab.size() < sizeof(Header)) return false;
        const Header* h = Hdr();
        if (h->Size != sizeof(Header)) return false;
        if (h->ConstantInfo + sizeof(ConstantInfo) * h->Constants > m_ctab.size()) return false;
        return true;
    }

    const Header*       Hdr() const noexcept              { return m_ctab.size() >= sizeof(Header) ? reinterpret_cast<const Header*>(m_ctab.data()) : nullptr; }
    const ConstantInfo* ConstantInfoArr() const noexcept  { return reinterpret_cast<const ConstantInfo*>(m_ctab.data() + Hdr()->ConstantInfo); }
    LPCSTR              Str(DWORD off) const noexcept     { return off < m_ctab.size() ? reinterpret_cast<LPCSTR>(m_ctab.data() + off) : ""; }
    bool ContainsBytes(const void* p, size_t n) const noexcept
    {
        const BYTE* b = reinterpret_cast<const BYTE*>(p);
        return b >= m_ctab.data() && b + n <= m_ctab.data() + m_ctab.size();
    }
    bool Contains(const ConstantInfo* ci) const noexcept { return ContainsBytes(ci, sizeof(ConstantInfo)); }

    std::vector<BYTE> m_ctab;
};
typedef ID3DXConstantTable* LPD3DXCONSTANTTABLE;

// D3DXCompileShader shim — routes through D3DCompile, then parses the resulting
// bytecode for a CTAB section so the returned constant table is meaningful.
inline HRESULT D3DXCompileShader(LPCSTR pSrcData, UINT SrcDataLen, const D3D_SHADER_MACRO* pDefines, ID3DInclude* pInclude,
                                 LPCSTR pFunctionName, LPCSTR pProfile, DWORD Flags, LPD3DXBUFFER* ppShader,
                                 LPD3DXBUFFER* ppErrorMsgs, LPD3DXCONSTANTTABLE* ppConstantTable) noexcept
{
    if (!ppShader) return E_POINTER;
    ID3DBlob* pBytecode = nullptr;
    ID3DBlob* pErrors = nullptr;
    HRESULT hr = D3DCompile(pSrcData, SrcDataLen, nullptr, pDefines, pInclude, pFunctionName, pProfile, Flags, 0, &pBytecode, &pErrors);
    if (ppShader)    *ppShader    = pBytecode;
    if (ppErrorMsgs) *ppErrorMsgs = pErrors; else if (pErrors) pErrors->Release();
    if (ppConstantTable)
    {
        auto* table = new ID3DXConstantTable();
        if (SUCCEEDED(hr) && pBytecode)
            table->Parse(reinterpret_cast<const DWORD*>(pBytecode->GetBufferPointer()));
        *ppConstantTable = table;
    }
    return hr;
}

// D3DXGetShaderConstantTable — real parser. Caller supplies an existing shader
// bytecode pointer; we walk the tokens and extract the CTAB blob.
inline HRESULT D3DXGetShaderConstantTable(const DWORD* pFunction, LPD3DXCONSTANTTABLE* ppConstantTable) noexcept
{
    if (!ppConstantTable) return E_POINTER;
    if (!pFunction)       { *ppConstantTable = nullptr; return E_INVALIDARG; }
    auto* table = new ID3DXConstantTable();
    if (!table->Parse(pFunction))
    {
        // No CTAB present — caller will see Constants == 0 from GetDesc. That's
        // legitimate (some game shaders strip the constant table).
    }
    *ppConstantTable = table;
    return S_OK;
}

// D3DX9 shader-reflection enums (originally from d3dx9shader.h). Reproduced here
// with identical numeric values so any serialised constant-description blobs and
// shader-bytecode-walking code keeps interpreting register sets / parameter
// classes the same way.
typedef enum _D3DXREGISTER_SET
{
    D3DXRS_BOOL,
    D3DXRS_INT4,
    D3DXRS_FLOAT4,
    D3DXRS_SAMPLER,
    D3DXRS_FORCE_DWORD = 0x7fffffff,
} D3DXREGISTER_SET;

typedef enum _D3DXPARAMETER_CLASS
{
    D3DXPC_SCALAR,
    D3DXPC_VECTOR,
    D3DXPC_MATRIX_ROWS,
    D3DXPC_MATRIX_COLUMNS,
    D3DXPC_OBJECT,
    D3DXPC_STRUCT,
    D3DXPC_FORCE_DWORD = 0x7fffffff,
} D3DXPARAMETER_CLASS;

typedef enum _D3DXPARAMETER_TYPE
{
    D3DXPT_VOID,
    D3DXPT_BOOL,
    D3DXPT_INT,
    D3DXPT_FLOAT,
    D3DXPT_STRING,
    D3DXPT_TEXTURE,
    D3DXPT_TEXTURE1D,
    D3DXPT_TEXTURE2D,
    D3DXPT_TEXTURE3D,
    D3DXPT_TEXTURECUBE,
    D3DXPT_SAMPLER,
    D3DXPT_SAMPLER1D,
    D3DXPT_SAMPLER2D,
    D3DXPT_SAMPLER3D,
    D3DXPT_SAMPLERCUBE,
    D3DXPT_PIXELSHADER,
    D3DXPT_VERTEXSHADER,
    D3DXPT_PIXELFRAGMENT,
    D3DXPT_VERTEXFRAGMENT,
    D3DXPT_UNSUPPORTED,
    D3DXPT_FORCE_DWORD = 0x7fffffff,
} D3DXPARAMETER_TYPE;

// Pointer aliases (legacy D3DX provided these as PD3DX{TYPE} / LPD3DX{TYPE}).
typedef D3DXVECTOR2*     LPD3DXVECTOR2;
typedef D3DXVECTOR3*     LPD3DXVECTOR3;
typedef D3DXVECTOR4*     LPD3DXVECTOR4;
typedef D3DXCOLOR*       LPD3DXCOLOR;
typedef D3DXQUATERNION*  LPD3DXQUATERNION;
typedef D3DXMATRIX*      LPD3DXMATRIX;

// Convenience helpers for the common load/op/store pattern.
// Pass D3DXMATRIX (= XMFLOAT4X4) by reference, work in XMMATRIX SIMD, store back.
namespace VireioCompat
{
    inline DirectX::XMMATRIX Load(const DirectX::XMFLOAT4X4& m) noexcept { return DirectX::XMLoadFloat4x4(&m); }
    inline DirectX::XMVECTOR Load(const DirectX::XMFLOAT4&   v) noexcept { return DirectX::XMLoadFloat4(&v); }
    inline DirectX::XMVECTOR Load(const DirectX::XMFLOAT3&   v) noexcept { return DirectX::XMLoadFloat3(&v); }
    inline DirectX::XMVECTOR Load(const DirectX::XMFLOAT2&   v) noexcept { return DirectX::XMLoadFloat2(&v); }

    inline void Store(DirectX::XMFLOAT4X4& dst, DirectX::FXMMATRIX m) noexcept { DirectX::XMStoreFloat4x4(&dst, m); }
    inline void Store(DirectX::XMFLOAT4&   dst, DirectX::FXMVECTOR v) noexcept { DirectX::XMStoreFloat4(&dst, v); }
    inline void Store(DirectX::XMFLOAT3&   dst, DirectX::FXMVECTOR v) noexcept { DirectX::XMStoreFloat3(&dst, v); }
    inline void Store(DirectX::XMFLOAT2&   dst, DirectX::FXMVECTOR v) noexcept { DirectX::XMStoreFloat2(&dst, v); }
}

// Operator overloads to preserve the legacy D3DX matrix/vector arithmetic syntax
// (sWorld = sScale * sRotate * sTrans; m_sView *= sTemp; pos1 - pos2; ...).
// These hide a load/op/store roundtrip per use — fine for scene-graph math where
// the host code wasn't SIMD-batched anyway. Anyone needing tight SIMD loops should
// drop down to XMMATRIX / XMVECTOR explicitly.
//
// Placed in the global namespace so ADL on DirectX:: types finds them. We don't add
// these inside namespace DirectX to avoid modifying a namespace we don't own.
inline DirectX::XMFLOAT4X4 operator*(const DirectX::XMFLOAT4X4& a, const DirectX::XMFLOAT4X4& b) noexcept
{
    DirectX::XMFLOAT4X4 r;
    DirectX::XMStoreFloat4x4(&r, DirectX::XMLoadFloat4x4(&a) * DirectX::XMLoadFloat4x4(&b));
    return r;
}
inline DirectX::XMFLOAT4X4& operator*=(DirectX::XMFLOAT4X4& a, const DirectX::XMFLOAT4X4& b) noexcept
{
    DirectX::XMStoreFloat4x4(&a, DirectX::XMLoadFloat4x4(&a) * DirectX::XMLoadFloat4x4(&b));
    return a;
}

// D3DMATRIX (from d3d9types.h) is bit-compatible with XMFLOAT4X4 (16 floats row-major);
// bridge operators let cross-plugin tracker output (D3DMATRIX) mix with our matrix math
// without callers having to reinterpret_cast at every site.
inline DirectX::XMFLOAT4X4 operator*(const DirectX::XMFLOAT4X4& a, const D3DMATRIX& b) noexcept
{
    return a * *reinterpret_cast<const DirectX::XMFLOAT4X4*>(&b);
}
inline DirectX::XMFLOAT4X4 operator*(const D3DMATRIX& a, const DirectX::XMFLOAT4X4& b) noexcept
{
    return *reinterpret_cast<const DirectX::XMFLOAT4X4*>(&a) * b;
}
inline DirectX::XMFLOAT4X4 operator*(const D3DMATRIX& a, const D3DMATRIX& b) noexcept
{
    return *reinterpret_cast<const DirectX::XMFLOAT4X4*>(&a) * *reinterpret_cast<const DirectX::XMFLOAT4X4*>(&b);
}

inline DirectX::XMFLOAT3 operator-(const DirectX::XMFLOAT3& a, const DirectX::XMFLOAT3& b) noexcept
{
    DirectX::XMFLOAT3 r;
    DirectX::XMStoreFloat3(&r, DirectX::XMVectorSubtract(DirectX::XMLoadFloat3(&a), DirectX::XMLoadFloat3(&b)));
    return r;
}
inline DirectX::XMFLOAT3 operator+(const DirectX::XMFLOAT3& a, const DirectX::XMFLOAT3& b) noexcept
{
    DirectX::XMFLOAT3 r;
    DirectX::XMStoreFloat3(&r, DirectX::XMVectorAdd(DirectX::XMLoadFloat3(&a), DirectX::XMLoadFloat3(&b)));
    return r;
}
inline DirectX::XMFLOAT4 operator-(const DirectX::XMFLOAT4& a, const DirectX::XMFLOAT4& b) noexcept
{
    DirectX::XMFLOAT4 r;
    DirectX::XMStoreFloat4(&r, DirectX::XMVectorSubtract(DirectX::XMLoadFloat4(&a), DirectX::XMLoadFloat4(&b)));
    return r;
}
inline DirectX::XMFLOAT4 operator+(const DirectX::XMFLOAT4& a, const DirectX::XMFLOAT4& b) noexcept
{
    DirectX::XMFLOAT4 r;
    DirectX::XMStoreFloat4(&r, DirectX::XMVectorAdd(DirectX::XMLoadFloat4(&a), DirectX::XMLoadFloat4(&b)));
    return r;
}

// Scalar operators on float vectors.
inline DirectX::XMFLOAT3& operator*=(DirectX::XMFLOAT3& v, float s) noexcept
{
    v.x *= s; v.y *= s; v.z *= s; return v;
}
inline DirectX::XMFLOAT3& operator/=(DirectX::XMFLOAT3& v, float s) noexcept
{
    const float inv = 1.0f / s; v.x *= inv; v.y *= inv; v.z *= inv; return v;
}
inline DirectX::XMFLOAT3 operator*(const DirectX::XMFLOAT3& v, float s) noexcept
{
    return DirectX::XMFLOAT3(v.x * s, v.y * s, v.z * s);
}
inline DirectX::XMFLOAT3 operator*(float s, const DirectX::XMFLOAT3& v) noexcept { return v * s; }
inline DirectX::XMFLOAT3 operator-(const DirectX::XMFLOAT3& v) noexcept
{
    return DirectX::XMFLOAT3(-v.x, -v.y, -v.z);
}

inline DirectX::XMFLOAT4& operator*=(DirectX::XMFLOAT4& v, float s) noexcept
{
    v.x *= s; v.y *= s; v.z *= s; v.w *= s; return v;
}
inline DirectX::XMFLOAT4 operator*(const DirectX::XMFLOAT4& v, float s) noexcept
{
    return DirectX::XMFLOAT4(v.x * s, v.y * s, v.z * s, v.w * s);
}
inline DirectX::XMFLOAT4 operator*(float s, const DirectX::XMFLOAT4& v) noexcept { return v * s; }

// D3DXToRadian / D3DXToDegree were macros in d3dx9math.h.
#ifndef D3DXToRadian
#define D3DXToRadian(degree) ((degree) * (3.14159265358979323846f / 180.0f))
#endif
#ifndef D3DXToDegree
#define D3DXToDegree(radian) ((radian) * (180.0f / 3.14159265358979323846f))
#endif

// Legacy D3DX free-function shims implemented in terms of DirectXMath.
// Same signatures as the originals from d3dx9math.h / d3dx10math.h so call
// sites need no rewrite — but the implementation has zero D3DX dependency.
// Return the output pointer (matches original D3DX behaviour for chaining).
inline D3DXMATRIX* D3DXMatrixIdentity(D3DXMATRIX* pOut) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixIdentity());
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixTranspose(D3DXMATRIX* pOut, const D3DXMATRIX* pIn) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixTranspose(DirectX::XMLoadFloat4x4(pIn)));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixInverse(D3DXMATRIX* pOut, float* pDeterminant, const D3DXMATRIX* pIn) noexcept
{
    DirectX::XMVECTOR vDet;
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixInverse(&vDet, DirectX::XMLoadFloat4x4(pIn)));
    if (pDeterminant) *pDeterminant = DirectX::XMVectorGetX(vDet);
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixMultiply(D3DXMATRIX* pOut, const D3DXMATRIX* pA, const D3DXMATRIX* pB) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMLoadFloat4x4(pA) * DirectX::XMLoadFloat4x4(pB));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixTranslation(D3DXMATRIX* pOut, float x, float y, float z) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixTranslation(x, y, z));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixScaling(D3DXMATRIX* pOut, float sx, float sy, float sz) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixScaling(sx, sy, sz));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixRotationX(D3DXMATRIX* pOut, float angle) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixRotationX(angle));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixRotationY(D3DXMATRIX* pOut, float angle) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixRotationY(angle));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixRotationZ(D3DXMATRIX* pOut, float angle) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixRotationZ(angle));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixRotationYawPitchRoll(D3DXMATRIX* pOut, float yaw, float pitch, float roll) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixRotationRollPitchYaw(pitch, yaw, roll));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixPerspectiveFovLH(D3DXMATRIX* pOut, float fovY, float aspect, float zn, float zf) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixPerspectiveFovLH(fovY, aspect, zn, zf));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixPerspectiveFovRH(D3DXMATRIX* pOut, float fovY, float aspect, float zn, float zf) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixPerspectiveFovRH(fovY, aspect, zn, zf));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixPerspectiveOffCenterLH(D3DXMATRIX* pOut, float l, float r, float b, float t, float zn, float zf) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixPerspectiveOffCenterLH(l, r, b, t, zn, zf));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixOrthoLH(D3DXMATRIX* pOut, float w, float h, float zn, float zf) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixOrthographicLH(w, h, zn, zf));
    return pOut;
}
inline D3DXMATRIX* D3DXMatrixLookAtLH(D3DXMATRIX* pOut, const D3DXVECTOR3* pEye, const D3DXVECTOR3* pAt, const D3DXVECTOR3* pUp) noexcept
{
    DirectX::XMStoreFloat4x4(pOut, DirectX::XMMatrixLookAtLH(DirectX::XMLoadFloat3(pEye), DirectX::XMLoadFloat3(pAt), DirectX::XMLoadFloat3(pUp)));
    return pOut;
}
inline float D3DXMatrixDeterminant(const D3DXMATRIX* pIn) noexcept
{
    return DirectX::XMVectorGetX(DirectX::XMMatrixDeterminant(DirectX::XMLoadFloat4x4(pIn)));
}
inline bool D3DXMatrixIsIdentity(const D3DXMATRIX* pIn) noexcept
{
    return DirectX::XMMatrixIsIdentity(DirectX::XMLoadFloat4x4(pIn));
}

// Vector shims (D3DXVec3Length / Normalize / Transform, D3DXVec4Normalize).
inline float D3DXVec3Length(const D3DXVECTOR3* pIn) noexcept
{
    return DirectX::XMVectorGetX(DirectX::XMVector3Length(DirectX::XMLoadFloat3(pIn)));
}
inline float D3DXVec3LengthSq(const D3DXVECTOR3* pIn) noexcept
{
    return DirectX::XMVectorGetX(DirectX::XMVector3LengthSq(DirectX::XMLoadFloat3(pIn)));
}
inline float D3DXVec3Dot(const D3DXVECTOR3* pA, const D3DXVECTOR3* pB) noexcept
{
    return DirectX::XMVectorGetX(DirectX::XMVector3Dot(DirectX::XMLoadFloat3(pA), DirectX::XMLoadFloat3(pB)));
}
inline D3DXVECTOR3* D3DXVec3Normalize(D3DXVECTOR3* pOut, const D3DXVECTOR3* pIn) noexcept
{
    DirectX::XMStoreFloat3(pOut, DirectX::XMVector3Normalize(DirectX::XMLoadFloat3(pIn)));
    return pOut;
}
inline D3DXVECTOR3* D3DXVec3Cross(D3DXVECTOR3* pOut, const D3DXVECTOR3* pA, const D3DXVECTOR3* pB) noexcept
{
    DirectX::XMStoreFloat3(pOut, DirectX::XMVector3Cross(DirectX::XMLoadFloat3(pA), DirectX::XMLoadFloat3(pB)));
    return pOut;
}
inline D3DXVECTOR4* D3DXVec3Transform(D3DXVECTOR4* pOut, const D3DXVECTOR3* pIn, const D3DXMATRIX* pMat) noexcept
{
    DirectX::XMStoreFloat4(pOut, DirectX::XMVector3Transform(DirectX::XMLoadFloat3(pIn), DirectX::XMLoadFloat4x4(pMat)));
    return pOut;
}
inline D3DXVECTOR3* D3DXVec3TransformCoord(D3DXVECTOR3* pOut, const D3DXVECTOR3* pIn, const D3DXMATRIX* pMat) noexcept
{
    DirectX::XMStoreFloat3(pOut, DirectX::XMVector3TransformCoord(DirectX::XMLoadFloat3(pIn), DirectX::XMLoadFloat4x4(pMat)));
    return pOut;
}
inline D3DXVECTOR3* D3DXVec3TransformNormal(D3DXVECTOR3* pOut, const D3DXVECTOR3* pIn, const D3DXMATRIX* pMat) noexcept
{
    DirectX::XMStoreFloat3(pOut, DirectX::XMVector3TransformNormal(DirectX::XMLoadFloat3(pIn), DirectX::XMLoadFloat4x4(pMat)));
    return pOut;
}
inline D3DXVECTOR4* D3DXVec4Normalize(D3DXVECTOR4* pOut, const D3DXVECTOR4* pIn) noexcept
{
    DirectX::XMStoreFloat4(pOut, DirectX::XMVector4Normalize(DirectX::XMLoadFloat4(pIn)));
    return pOut;
}
inline D3DXVECTOR4* D3DXVec4Transform(D3DXVECTOR4* pOut, const D3DXVECTOR4* pIn, const D3DXMATRIX* pMat) noexcept
{
    DirectX::XMStoreFloat4(pOut, DirectX::XMVector4Transform(DirectX::XMLoadFloat4(pIn), DirectX::XMLoadFloat4x4(pMat)));
    return pOut;
}
