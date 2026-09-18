# fjs native core: QuickJS-ng (vendored) + fjs C++ layer.
# Builds standalone (host tests) and as a subproject of the Flutter plugin
# (Android via externalNativeBuild, iOS/macOS via CocoaPods).
cmake_minimum_required(VERSION 3.14...3.31)
project(fjs LANGUAGES C CXX)

# Keep in sync with pubspec.yaml `version:`.
set(FJS_VERSION 0.1.4)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# ---- vendored quickjs-ng -------------------------------------------------
set(QUICKJS_DIR ${CMAKE_CURRENT_SOURCE_DIR}/quickjs)
add_library(quickjs STATIC
    ${QUICKJS_DIR}/cutils.c
    ${QUICKJS_DIR}/libbf.c
    ${QUICKJS_DIR}/libregexp.c
    ${QUICKJS_DIR}/libunicode.c
    ${QUICKJS_DIR}/quickjs.c
)
target_include_directories(quickjs PUBLIC ${QUICKJS_DIR})
target_compile_definitions(quickjs PRIVATE _GNU_SOURCE)
if(WIN32)
    target_compile_definitions(quickjs PRIVATE WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0601)
endif()
find_package(Threads REQUIRED)
target_link_libraries(quickjs PUBLIC Threads::Threads)
find_library(M_LIB m)
if(M_LIB)
    target_link_libraries(quickjs PUBLIC ${M_LIB})
endif()

# quickjs-ng is warning-clean C; silence aggressive host defaults
if(NOT MSVC)
    target_compile_options(quickjs PRIVATE -Wno-unknown-warning-option -w)
endif()

# ---- fjs core -------------------------------------------------------------
add_library(fjs_core STATIC
    src/vm.cpp
    src/natives.cpp
    src/value.cpp
)
target_include_directories(fjs_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(fjs_core PUBLIC quickjs)
if(NOT MSVC)
    target_compile_options(fjs_core PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

# ---- shared library consumed by Dart FFI ----------------------------------
add_library(fjs SHARED
    src/vm.cpp
    src/natives.cpp
    src/value.cpp
)
target_include_directories(fjs PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(fjs PRIVATE quickjs)
set_target_properties(fjs PROPERTIES
    # fjs_* entry points must stay visible for dart:ffi DynamicLibrary.lookup
    C_VISIBILITY_PRESET default
    CXX_VISIBILITY_PRESET default
)

# ---- host smoke test -------------------------------------------------------
if(FJS_BUILD_TESTS)
    add_executable(fjs-test test/main.cpp)
    target_include_directories(fjs-test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
    # test links the objects directly so it exercises the same code paths
    target_link_libraries(fjs-test PRIVATE fjs_core)
    enable_testing()
    add_test(NAME fjs-core COMMAND fjs-test)
endif()

# ---- fjsc/fjsrun host tools (host only) ------------------------------------
if(NOT ANDROID AND NOT IOS AND NOT FJS_APPLE_STATIC)
    add_executable(fjsc tools/fjsc.cpp)
    target_include_directories(fjsc PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
    target_link_libraries(fjsc PRIVATE fjs_core)

    add_executable(fjsrun tools/fjsrun.cpp)
    target_include_directories(fjsrun PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
    target_link_libraries(fjsrun PRIVATE fjs_core)
endif()
