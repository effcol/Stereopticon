cmake_minimum_required(VERSION 3.12)
project(Simulated_Reality_OpenTrack_Bridge)

set(CMAKE_CXX_STANDARD 17)

# SDK cmake config location
set(LEIASR_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." CACHE PATH "LeiaSR SDK root")
list(APPEND CMAKE_PREFIX_PATH "${LEIASR_ROOT}/lib/cmake")

find_package(simulatedreality REQUIRED)

add_executable(Simulated_Reality_OpenTrack_Bridge
    ${PROJECT_SOURCE_DIR}/src/main.cpp
)

target_link_libraries(Simulated_Reality_OpenTrack_Bridge
    simulatedreality
    ws2_32
)
