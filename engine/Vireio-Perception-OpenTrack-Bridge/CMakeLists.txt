cmake_minimum_required(VERSION 3.20)
project(Vireio_Perception_OpenTrack_Bridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Shared sources for every proxy variant.
set(PROXY_SOURCES
    src/main.cpp
    src/d3d9_proxy.cpp
    src/opentrack_listener.cpp
    src/headpose_matrix.cpp
    src/config.cpp
)

include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

# Helper — produce one proxy DLL targeting a specific slot. `slot` is the
# system DLL we're masquerading as (d3d9, dinput8, winmm, version). Same
# code, different .def file controls the export shape.
function(add_proxy_variant slot deffile)
    set(target "Vireio-OpenTrack-Bridge-${slot}")
    add_library(${target} SHARED ${PROXY_SOURCES})
    target_link_libraries(${target} PRIVATE d3d9 ws2_32)
    set_target_properties(${target} PROPERTIES
        OUTPUT_NAME "${slot}"   # produces ${slot}.dll, ready to drop in
        PREFIX ""
    )
    if(MSVC)
        target_compile_options(${target} PRIVATE /W3 /permissive-)
        target_compile_definitions(${target} PRIVATE "PROXY_SLOT_${slot}")
        target_link_options(${target} PRIVATE "/DEF:${CMAKE_CURRENT_SOURCE_DIR}/src/${deffile}")
    endif()
endfunction()

# Primary slot — works for every game that loads d3d9.dll.
add_proxy_variant(d3d9    d3d9_exports.def)
# Collision-friendly slot — used when wiz3D / Geo-11 / another stereo mod
# already occupies d3d9.dll. Windows loads dinput8.dll local-first too,
# and the export shape is trivially small.
add_proxy_variant(dinput8 dinput8_exports.def)
# Other common alternates — uncomment when needed.
# add_proxy_variant(winmm   winmm_exports.def)
# add_proxy_variant(version version_exports.def)
