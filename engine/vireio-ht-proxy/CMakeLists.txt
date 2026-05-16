cmake_minimum_required(VERSION 3.20)
project(vireio_ht_proxy LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Output is a DLL the user renames to d3d9.dll and drops next to game.exe.
add_library(vireio-ht SHARED
    src/main.cpp
    src/d3d9_proxy.cpp
    src/opentrack_listener.cpp
    src/headpose_matrix.cpp
    src/config.cpp
)

target_include_directories(vireio-ht PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# Link against the system d3d9 import library so we can resolve the real
# Direct3DCreate9 entry point from %SystemRoot%\System32\d3d9.dll at runtime.
target_link_libraries(vireio-ht PRIVATE d3d9 ws2_32)

# Stable export name regardless of build mode.
set_target_properties(vireio-ht PROPERTIES
    OUTPUT_NAME "vireio-ht"
    PREFIX ""
)

# Export the d3d9 entry points so apps load us instead of the real DLL.
if(MSVC)
    target_compile_options(vireio-ht PRIVATE /W3 /permissive-)
    target_link_options(vireio-ht PRIVATE /DEF:${CMAKE_CURRENT_SOURCE_DIR}/src/d3d9_exports.def)
endif()
