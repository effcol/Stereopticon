// headpose_matrix.cpp — apply the current head pose to a D3D9 view matrix.
//
// D3D9 view matrices are row-major (row vectors post-multiplied by the matrix).
// The view matrix transforms world → view space. To rotate the view by the
// user's head pose, we pre-multiply by the inverse of the head transform.
//
// For a head rotation R and translation t, the head-to-world transform is
// T(t) * R. The view-from-head adjustment is the inverse: R^T * T(-t).
// We pre-multiply onto the game's view matrix:
//     adjusted_view = head_inverse * game_view
//
// In row-vector convention that translates to:
//     adjusted_view = R^T(yaw, pitch, roll) * T(-x, -y, -z) * game_view
#include "vireio_ht.h"

#include <cmath>
#include <cstring>

namespace vireio_ht {

namespace {

inline void mul4x4(D3DMATRIX& out, const D3DMATRIX& a, const D3DMATRIX& b) {
    D3DMATRIX r{};
    for (int i = 0; i < 4; ++i) {
        for (int j = 0; j < 4; ++j) {
            r.m[i][j] = a.m[i][0] * b.m[0][j]
                      + a.m[i][1] * b.m[1][j]
                      + a.m[i][2] * b.m[2][j]
                      + a.m[i][3] * b.m[3][j];
        }
    }
    out = r;
}

inline D3DMATRIX rotation_yxz(float yaw, float pitch, float roll) {
    // Compose Yaw (Y) * Pitch (X) * Roll (Z) in row-vector convention.
    const float cy = std::cos(yaw),   sy = std::sin(yaw);
    const float cp = std::cos(pitch), sp = std::sin(pitch);
    const float cr = std::cos(roll),  sr = std::sin(roll);

    D3DMATRIX R{};
    R.m[0][0] =  cy*cr + sy*sp*sr;
    R.m[0][1] =  cp*sr;
    R.m[0][2] = -sy*cr + cy*sp*sr;
    R.m[1][0] = -cy*sr + sy*sp*cr;
    R.m[1][1] =  cp*cr;
    R.m[1][2] =  sy*sr + cy*sp*cr;
    R.m[2][0] =  sy*cp;
    R.m[2][1] = -sp;
    R.m[2][2] =  cy*cp;
    R.m[3][3] =  1.0f;
    return R;
}

inline D3DMATRIX transpose_3x3_identity_translation(const D3DMATRIX& R, float tx, float ty, float tz) {
    // R^T with translation appended (row-vector form).
    D3DMATRIX out{};
    out.m[0][0] = R.m[0][0]; out.m[0][1] = R.m[1][0]; out.m[0][2] = R.m[2][0];
    out.m[1][0] = R.m[0][1]; out.m[1][1] = R.m[1][1]; out.m[1][2] = R.m[2][1];
    out.m[2][0] = R.m[0][2]; out.m[2][1] = R.m[1][2]; out.m[2][2] = R.m[2][2];
    // -t * R^T  (row-vector convention: bottom row holds translation).
    out.m[3][0] = -(tx * out.m[0][0] + ty * out.m[1][0] + tz * out.m[2][0]);
    out.m[3][1] = -(tx * out.m[0][1] + ty * out.m[1][1] + tz * out.m[2][1]);
    out.m[3][2] = -(tx * out.m[0][2] + ty * out.m[1][2] + tz * out.m[2][2]);
    out.m[3][3] = 1.0f;
    return out;
}

}  // namespace

void apply_headpose_to_view(D3DMATRIX& view) {
    const float yaw   = pose().yaw  .load(std::memory_order_relaxed);
    const float pitch = pose().pitch.load(std::memory_order_relaxed);
    const float roll  = pose().roll .load(std::memory_order_relaxed);
    const float tx    = pose().x    .load(std::memory_order_relaxed);
    const float ty    = pose().y    .load(std::memory_order_relaxed);
    const float tz    = pose().z    .load(std::memory_order_relaxed);

    const D3DMATRIX R    = rotation_yxz(yaw, pitch, roll);
    const D3DMATRIX hInv = transpose_3x3_identity_translation(R, tx, ty, tz);
    mul4x4(view, hInv, view);
}

}  // namespace vireio_ht
