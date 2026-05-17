// d3dx9.h — forwarding shim for v3 sources that #include <d3dx9.h>.
//
// The legacy DirectX SDK June 2010 (which shipped d3dx9.h) is unavailable
// on modern Windows. v4's engine already replaced it with a DirectXMath +
// hand-rolled CTAB-parser compatibility layer at Vireio_D3DX_Compat.h.
// v3 sources still write `#include <d3dx9.h>`; this file lets that just
// work as long as engine/vireio/PluginSection/Include is on the include
// search path (which it is in the modernized v3 vcxprojs).
#pragma once
#include "Vireio_D3DX_Compat.h"
