/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pulfrich_to_SBS_or_TAB.fx
 *
 * ReShade implementation of Pulfrich_to_SBS_or_TAB.
 *
 * Features:
 * - SBS/TAB output packing + swaps
 * - Composite preview: show L, show R, split L|R, split R|L
 * - Composite INPUT SBS mode: treat input as SBS (L|R or R|L) so you can apply Pulfrich to SBS videos
 * - Composite Apply Pulfrich: apply Pulfrich to only one SIDE in composite split
 * - Pulfrich modes: ND Filter or Frame Delay
 * - Auto delay selection: chooses nearest history frame that differs from current (1..4)
 *
 * Notes:
 * - Frame Delay uses internal history buffers (Prev1..Prev4) captured each frame.
 * - Auto delay uses a tiny 1x1 render target to store chosen delay frame (df/4 in R).
 *
 * By: Effie Colton, 2026.
 */

// -----------------------------------------------------------------------------
// Minimal ReShade-compatible fullscreen vertex shader (no ReShade.fxh required)
// -----------------------------------------------------------------------------

struct VSOUT
{
    float4 pos : SV_Position;
    float2 uv  : TEXCOORD0;
};

VSOUT VS_Fullscreen(uint id : SV_VertexID)
{
    VSOUT o;
    // Triangle covering screen: ( -1,-1 ), ( -1, 3 ), ( 3,-1 )
    float2 v = float2((id == 2) ? 3.0 : -1.0, (id == 1) ? 3.0 : -1.0);
    o.pos = float4(v, 0.0, 1.0);
    o.uv  = float2((v.x + 1.0) * 0.5, (1.0 - v.y) * 0.5);
    return o;
}

// -----------------------------------------------------------------------------
// UI PARAMETERS
// -----------------------------------------------------------------------------

uniform int force_layout <
    ui_label = "Force Layout";
    ui_type  = "combo";
    ui_items =
        "Composite (debug / split)\0"
        "Side-by-Side (Left|Right)\0"
        "Side-by-Side Swap (Right|Left)\0"
        "Top-and-Bottom (Top over Bottom)\0"
        "Top-and-Bottom Swap (Bottom over Top)\0";
    ui_min = 0; ui_max = 4;
> = 1;

uniform int force_aspect <
    ui_label = "Force Aspect";
    ui_type  = "combo";
    ui_items =
        "Full (normal)\0"
        "Top-and-Bottom only (treat output height as half)\0"
        "Side-by-Side only (treat output width as half)\0";
    ui_min = 0; ui_max = 2;
> = 0;

uniform float zoom <
    ui_label = "Zoom";
    ui_type  = "slider";
    ui_min = 0.25; ui_max = 4.0;
    ui_step = 0.005;
> = 1.0;

uniform float stretch_x <
    ui_label = "Stretch X";
    ui_type  = "slider";
    ui_min = 0.25; ui_max = 4.0;
    ui_step = 0.005;
> = 1.0;

uniform float stretch_y <
    ui_label = "Stretch Y";
    ui_type  = "slider";
    ui_min = 0.25; ui_max = 4.0;
    ui_step = 0.005;
> = 1.0;

uniform int pulfrich_mode <
    ui_label = "Pulfrich Mode";
    ui_type  = "combo";
    ui_items =
        "ND Filter\0"
        "Frame Delay\0";
    ui_min = 0; ui_max = 1;
> = 1;

uniform int affected_eye <
    ui_label = "Affected Eye";
    ui_type  = "combo";
    ui_items =
        "Left\0"
        "Right\0";
    ui_min = 0; ui_max = 1;
> = 1; // default Right

uniform float nd_strength <
    ui_label = "ND Strength (ND mode)";
    ui_type  = "slider";
    ui_min = 0.0; ui_max = 1.0;
    ui_step = 0.01;
> = 0.60;

uniform int delay_auto <
    ui_label = "Delay Select (Delay mode)";
    ui_type  = "combo";
    ui_items =
        "Manual\0"
        "Auto\0";
    ui_min = 0; ui_max = 1;
> = 1;

uniform int delay_frames <
    ui_label = "Delay Frames (Manual, Delay mode)";
    ui_type  = "slider";
    ui_min = 1; ui_max = 4;
    ui_step = 1;
> = 1;

uniform int max_search_frames <
    ui_label = "Auto Search Depth (1..4)";
    ui_type  = "slider";
    ui_min = 1; ui_max = 4;
    ui_step = 1;
> = 4;

uniform float diff_threshold <
    ui_label = "Auto Diff Threshold";
    ui_type  = "slider";
    ui_min = 0.0; ui_max = 0.02;
    ui_step = 0.0001;
> = 0.0005;

// ---- Composite split + SBS input ----
uniform int composite_mode <
    ui_label = "Composite Mode";
    ui_type  = "combo";
    ui_items =
        "Show Left full-screen\0"
        "Show Right full-screen\0"
        "Split L|R\0"
        "Split R|L\0";
    ui_min = 0; ui_max = 3;
> = 0;

uniform int composite_input_sbs <
    ui_label = "Composite Input SBS";
    ui_type  = "combo";
    ui_items =
        "Off (treat input as mono)\0"
        "Input is SBS (L|R)\0"
        "Input is SBS swapped (R|L)\0";
    ui_min = 0; ui_max = 2;
> = 0;

uniform int composite_apply_side <
    ui_label = "Composite Apply Pulfrich";
    ui_type  = "combo";
    ui_items =
        "None\0"
        "Left side\0"
        "Right side\0";
    ui_min = 0; ui_max = 2;
> = 2; // default Right side

// -----------------------------------------------------------------------------
// BACKBUFFER + INTERNAL RTs (Current + History + AutoDF)
// -----------------------------------------------------------------------------

texture BackBufferTex : COLOR;
sampler BackBufferSampler { Texture = BackBufferTex; };

texture CurTex  { Width = BUFFER_WIDTH; Height = BUFFER_HEIGHT; Format = RGBA8; };
sampler CurSamp { Texture = CurTex; };

texture Prev1Tex { Width = BUFFER_WIDTH; Height = BUFFER_HEIGHT; Format = RGBA8; };
texture Prev2Tex { Width = BUFFER_WIDTH; Height = BUFFER_HEIGHT; Format = RGBA8; };
texture Prev3Tex { Width = BUFFER_WIDTH; Height = BUFFER_HEIGHT; Format = RGBA8; };
texture Prev4Tex { Width = BUFFER_WIDTH; Height = BUFFER_HEIGHT; Format = RGBA8; };

sampler Prev1Samp { Texture = Prev1Tex; };
sampler Prev2Samp { Texture = Prev2Tex; };
sampler Prev3Samp { Texture = Prev3Tex; };
sampler Prev4Samp { Texture = Prev4Tex; };

// 1x1 chosen df in R as df/4
texture AutoDFTex { Width = 1; Height = 1; Format = RGBA8; };
sampler AutoDFSamp { Texture = AutoDFTex; };

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

float snap_to_step(float x, float step) { return floor(x / step + 0.5) * step; }
float clamp01(float x) { return saturate(x); }

float2 fit_inside(float2 uv, float srcAsp, float dstAsp)
{
    float2 p = uv - 0.5;
    if (dstAsp > srcAsp) p.x *= (dstAsp / srcAsp);
    else                 p.y *= (srcAsp / dstAsp);
    return p + 0.5;
}

float2 apply_zoom_stretch(float2 uv, float z, float sx, float sy)
{
    uv = (uv - 0.5) * z + 0.5;
    uv = (uv - 0.5) * float2(sx, sy) + 0.5;
    return uv;
}

float4 sample_safe(sampler s, float2 uv)
{
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0)
        return 0.0.xxxx;
    return tex2D(s, uv);
}

float3 apply_nd(float3 rgb, float strength)
{
    float k = lerp(1.0, 0.05, clamp01(strength));
    return rgb * k;
}

float rgb_diff(float3 a, float3 b)
{
    float3 d = abs(a - b);
    return (d.x + d.y + d.z) * (1.0 / 3.0);
}

float4 sample_history_df(float2 uv, int df)
{
    if (df == 1) return sample_safe(Prev1Samp, uv);
    if (df == 2) return sample_safe(Prev2Samp, uv);
    if (df == 3) return sample_safe(Prev3Samp, uv);
    if (df == 4) return sample_safe(Prev4Samp, uv);
    return sample_safe(CurSamp, uv);
}

float diff_score_history(int df)
{
    float2 p0 = float2(0.50, 0.50);
    float2 p1 = float2(0.25, 0.25);
    float2 p2 = float2(0.75, 0.25);
    float2 p3 = float2(0.25, 0.75);
    float2 p4 = float2(0.75, 0.75);

    float3 c0 = sample_safe(CurSamp, p0).rgb; float3 h0 = sample_history_df(p0, df).rgb;
    float3 c1 = sample_safe(CurSamp, p1).rgb; float3 h1 = sample_history_df(p1, df).rgb;
    float3 c2 = sample_safe(CurSamp, p2).rgb; float3 h2 = sample_history_df(p2, df).rgb;
    float3 c3 = sample_safe(CurSamp, p3).rgb; float3 h3 = sample_history_df(p3, df).rgb;
    float3 c4 = sample_safe(CurSamp, p4).rgb; float3 h4 = sample_history_df(p4, df).rgb;

    float acc = 0.0;
    acc += rgb_diff(c0, h0);
    acc += rgb_diff(c1, h1);
    acc += rgb_diff(c2, h2);
    acc += rgb_diff(c3, h3);
    acc += rgb_diff(c4, h4);
    return acc * (1.0 / 5.0);
}

int pick_auto_delay()
{
    int maxF = clamp(max_search_frames, 1, 4);
    float th = max(0.0, diff_threshold);

    if (maxF >= 1 && diff_score_history(1) > th) return 1;
    if (maxF >= 2 && diff_score_history(2) > th) return 2;
    if (maxF >= 3 && diff_score_history(3) > th) return 3;
    if (maxF >= 4 && diff_score_history(4) > th) return 4;
    return 0;
}

// Apply pulfrich stream to a single sample stream (ND or Delay)
float4 pulfrich_stream(float2 uv, float4 cur, bool affectThis)
{
    if (!affectThis) return cur;

    if (pulfrich_mode == 0)
    {
        float4 o = cur;
        o.rgb = apply_nd(o.rgb, nd_strength);
        return o;
    }

    int df = 0;
    if (delay_auto == 1)
    {
        float dfN = tex2D(AutoDFSamp, float2(0.5, 0.5)).r;
        df = (int)floor(dfN * 4.0 + 0.5);
    }
    else
    {
        df = clamp(delay_frames, 1, 4);
    }

    df = clamp(df, 0, 4);
    if (df >= 1) return sample_history_df(uv, df);
    return cur;
}

// -----------------------------------------------------------------------------
// PASSES
// -----------------------------------------------------------------------------

float4 PS_Copy_BackBuffer(float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target
{
    return tex2D(BackBufferSampler, uv);
}

float4 PS_Copy_Cur(float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target
{
    return tex2D(CurSamp, uv);
}

float4 PS_Copy_Prev1(float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target
{
    return tex2D(Prev1Samp, uv);
}

float4 PS_Copy_Prev2(float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target
{
    return tex2D(Prev2Samp, uv);
}

float4 PS_Copy_Prev3(float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target
{
    return tex2D(Prev3Samp, uv);
}

// 1x1 auto df
float4 PS_AutoDF(float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target
{
    int df = 0;
    if (pulfrich_mode == 1 && delay_auto == 1)
        df = pick_auto_delay();

    return float4((float)df * (1.0 / 4.0), 0.0, 0.0, 1.0);
}

// Main output
float4 PS_Pulfrich(float4 pos : SV_Position, float2 uv_in : TEXCOORD0) : SV_Target
{
    float2 outSz = float2(BUFFER_WIDTH, BUFFER_HEIGHT);

    float srcAsp  = outSz.x / max(outSz.y, 1.0);
    float fullAsp = srcAsp;

    float dstAsp = fullAsp;
    if (force_aspect == 1) dstAsp = fullAsp * 2.0; // TAB
    if (force_aspect == 2) dstAsp = fullAsp * 0.5; // SBS

    float z  = snap_to_step(zoom,      0.005);
    float sx = snap_to_step(stretch_x, 0.005);
    float sy = snap_to_step(stretch_y, 0.005);

    int lay = force_layout;
    bool wantSBS = (lay == 1 || lay == 2);
    bool wantTAB = (lay == 3 || lay == 4);

    // ---------------- COMPOSITE SPLIT MODES ----------------
    if (lay == 0)
    {
        int cm = composite_mode;              // 0..3
        int inSBS = composite_input_sbs;      // 0..2
        int applySide = composite_apply_side; // 0..2

        // Full-screen debug: show generated L/R from mono input
        if (cm == 0 || cm == 1)
        {
            float2 uv = fit_inside(uv_in, srcAsp, dstAsp);
            uv = apply_zoom_stretch(uv, z, sx, sy);

            float4 cur = sample_safe(CurSamp, uv);

            float4 L = cur;
            float4 R = cur;

            bool affectRight = (affected_eye == 1);
            if (affectRight) R = pulfrich_stream(uv, cur, true);
            else             L = pulfrich_stream(uv, cur, true);

            return (cm == 0) ? L : R;
        }

        // Split output
        bool splitSwap = (cm == 3);

        int side = (uv_in.x >= 0.5) ? 1 : 0; // 0=left side, 1=right side
        int outEye = side;
        if (splitSwap) outEye = 1 - outEye;

        // UV within that screen half
        float2 hUV = uv_in;
        float x2 = hUV.x * 2.0;
        int pane = (x2 >= 1.0) ? 1 : 0;
        hUV.x = x2 - (float)pane;

        float2 srcUV = hUV;

        // If input is SBS, choose input half based on outEye
        if (inSBS != 0)
        {
            int inEye = outEye;
            if (inSBS == 2) inEye = 1 - inEye; // swapped input
            srcUV.x = srcUV.x * 0.5 + (inEye == 1 ? 0.5 : 0.0);
        }

        srcUV = fit_inside(srcUV, srcAsp, dstAsp);
        srcUV = apply_zoom_stretch(srcUV, z, sx, sy);

        float4 curSide = sample_safe(CurSamp, srcUV);

        bool doPulfrich = false;
        if (applySide == 1 && side == 0) doPulfrich = true;
        if (applySide == 2 && side == 1) doPulfrich = true;

        return pulfrich_stream(srcUV, curSide, doPulfrich);
    }

    // ---------------- NORMAL SBS/TAB PACKING ----------------

    float2 uv = fit_inside(uv_in, srcAsp, dstAsp);
    uv = apply_zoom_stretch(uv, z, sx, sy);

    int whichEyeView = 0;
    float2 localUV = uv;

    if (wantSBS)
    {
        float x2 = localUV.x * 2.0;
        if (x2 <= 0.0 || x2 >= 2.0) return 0.0.xxxx;

        int pane = (x2 >= 1.0) ? 1 : 0;
        localUV.x = x2 - (float)pane;

        whichEyeView = pane;
        if (lay == 2) whichEyeView = 1 - whichEyeView; // SBS swap
    }
    else
    {
        float y2 = localUV.y * 2.0;
        if (y2 <= 0.0 || y2 >= 2.0) return 0.0.xxxx;

        int pane = (y2 >= 1.0) ? 1 : 0;
        localUV.y = y2 - (float)pane;

        whichEyeView = pane;
        if (lay == 4) whichEyeView = 1 - whichEyeView; // TAB swap
    }

    float4 cur = sample_safe(CurSamp, localUV);
    float4 L = cur;
    float4 R = cur;

    bool affectRight = (affected_eye == 1);

    if (pulfrich_mode == 0)
    {
        if (affectRight) R.rgb = apply_nd(R.rgb, nd_strength);
        else             L.rgb = apply_nd(L.rgb, nd_strength);
    }
    else
    {
        // Delay mode: feed previous frame to one eye
        int df = 0;
        if (delay_auto == 1)
        {
            float dfN = tex2D(AutoDFSamp, float2(0.5, 0.5)).r;
            df = (int)floor(dfN * 4.0 + 0.5);
        }
        else
        {
            df = clamp(delay_frames, 1, 4);
        }

        df = clamp(df, 0, 4);
        if (df >= 1)
        {
            float4 prev = sample_history_df(localUV, df);
            if (affectRight) R = prev;
            else             L = prev;
        }
    }

    return (whichEyeView == 0) ? L : R;
}

// -----------------------------------------------------------------------------
// TECHNIQUE (captures Cur, picks AutoDF, outputs, then shifts history)
// -----------------------------------------------------------------------------

technique Pulfrich_to_SBS_or_TAB
{
    pass CaptureCur
    {
        RenderTarget = CurTex;
        VertexShader = VS_Fullscreen;
        PixelShader  = PS_Copy_BackBuffer;
    }

    pass AutoDelayPick
    {
        RenderTarget = AutoDFTex;
        VertexShader = VS_Fullscreen;
        PixelShader  = PS_AutoDF;
    }

    pass Output
    {
        VertexShader = VS_Fullscreen;
        PixelShader  = PS_Pulfrich;
    }

    // history shift (after output)
    pass Shift4 { RenderTarget = Prev4Tex; VertexShader = VS_Fullscreen; PixelShader = PS_Copy_Prev3; }
    pass Shift3 { RenderTarget = Prev3Tex; VertexShader = VS_Fullscreen; PixelShader = PS_Copy_Prev2; }
    pass Shift2 { RenderTarget = Prev2Tex; VertexShader = VS_Fullscreen; PixelShader = PS_Copy_Prev1; }
    pass Shift1 { RenderTarget = Prev1Tex; VertexShader = VS_Fullscreen; PixelShader = PS_Copy_Cur;   }
}