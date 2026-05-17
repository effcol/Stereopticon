// D3DX9Shader.h — forwarder shim. Routes any v3 source that includes
// the legacy D3DX9Shader.h directly to the same compat layer that
// d3dx9.h uses (the constant-table parser + shader-related stubs all
// live in Vireio_D3DX_Compat.h already).
#pragma once
#include "Vireio_D3DX_Compat.h"
