# fjs native core: vendored JS engine (PrimJS or quickjs-ng) + fjs C++ layer.
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

# ---- vendored JS engine (spec 091) ----------------------------------------
# Two flavors, selected per BUILD TREE (give each flavor its own -B dir —
# toggling FJS_JS_ENGINE inside one configured tree fights the CMake cache):
#
#   primjs  (default)  PrimJS 4.1.1, LEPUS_* API. spec 088 switched here for
#                      the built-in CDP inspector; fjs debug only works on
#                      this flavor. See primjs/VENDORED.md.
#   quickjs            quickjs-ng 0.9.0, JS_* API. The pre-088 engine,
#                      restored in spec 091 for comparison and as a fallback.
#                      No inspector exists for it — the debugger module is
#                      not built and bundles carry engine id quickjs-ng-0.9.0.
#
# Both cores compile against src/engine.h; the flavor only decides which
# engine's headers that facade binds to (FJS_ENGINE_* define) and which
# static library fjs_core links.
set(FJS_JS_ENGINE "primjs" CACHE STRING "Vendored JS engine: primjs | quickjs")
option(FJS_DEBUGGER "Build the pluggable debugger module (spec 088/090)" ON)

if(FJS_JS_ENGINE STREQUAL "quickjs")
    if(FJS_DEBUGGER)
        message(STATUS "fjs: FJS_JS_ENGINE=quickjs — no CDP inspector exists "
                       "for quickjs-ng, so the debugger module is not built "
                       "(fjs debug needs the primjs flavor)")
    endif()
    set(FJS_DEBUGGER_ENABLED OFF)

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

    set(FJS_ENGINE_DEFINE FJS_ENGINE_QUICKJS)
    set(FJS_ENGINE_INCLUDE_DIRS ${QUICKJS_DIR})
else()
    # PrimJS's CMakeLists defines the `quickjs` target (archive name
    # "quick"); it is EXCLUDE_FROM_ALL so only it gets built, never the napi
    # targets. spec 090: the engine NEVER contains the inspector — FJS_DEBUGGER
    # only says whether to also build the debugger module (inspector +
    # transport) next to it; libfjs is byte-identical either way.
    set(FJS_DEBUGGER_ENABLED ${FJS_DEBUGGER})
    # Stays ON unconditionally: it is what keeps the debugger fields in the
    # engine's structs, so the module and the engine agree on layout. The
    # inspector SOURCES are what PRIMJS_INSPECTOR_AS_MODULE moves out.
    set(ENABLE_QUICKJS_DEBUGGER ON CACHE BOOL "PrimJS inspector sources" FORCE)
    set(PRIMJS_INSPECTOR_AS_MODULE ON CACHE BOOL "inspector in its own target" FORCE)
    # The inspector now binds the engine internals it uses across a module
    # boundary, so they cannot stay hidden — see primjs/src/.../base_export.h.
    add_compile_definitions(FJS_EXPORT_ENGINE_INTERNALS)
    add_subdirectory(primjs EXCLUDE_FROM_ALL)
    # tool/build-apple.sh archives `libquickjs.a` into the xcframeworks; the
    # upstream target's output name is "quick".
    set_target_properties(quickjs PROPERTIES OUTPUT_NAME "quickjs")

    set(FJS_ENGINE_DEFINE FJS_ENGINE_PRIMJS)
    set(FJS_ENGINE_INCLUDE_DIRS
        ${CMAKE_CURRENT_SOURCE_DIR}/primjs/src/interpreter/quickjs/include
        ${CMAKE_CURRENT_SOURCE_DIR}/primjs/src/interpreter
        ${CMAKE_CURRENT_SOURCE_DIR}/primjs/src
    )
endif()

find_package(Threads REQUIRED)
find_library(M_LIB m)

# ---- fjs core -------------------------------------------------------------
# spec 090: the debugger is a MODULE, never part of the engine —
#   engine (here)        vm/natives/value + debugger-glue.cpp, the transport
#                        slot and the pump/teardown gates. Inert with no
#                        module loaded; contains no inspector, no socket.
#   debugger-plugin.cpp  + the PrimJS inspector objects => libfjs_debugger,
#                        which release builds simply do not ship.
set(FJS_ENGINE_SOURCES src/vm.cpp src/natives.cpp src/value.cpp src/debugger-glue.cpp)
add_library(fjs_core STATIC ${FJS_ENGINE_SOURCES})
target_include_directories(fjs_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${FJS_ENGINE_INCLUDE_DIRS}
)
target_compile_definitions(fjs_core PUBLIC ${FJS_ENGINE_DEFINE})
# Threads: PrimJS's own CMakeLists never links it, but its GC/thread-pool
# code needs pthread symbols at final link (host builds; Android's libc
# has them builtin).
target_link_libraries(fjs_core PUBLIC quickjs Threads::Threads)
if(ANDROID)
    # PrimJS's quickjs.cc calls __android_log_print (its logging layer);
    # the log library is only auto-linked for Android shared libs.
    find_library(LOG_LIB log)
    target_link_libraries(fjs_core PUBLIC ${LOG_LIB})
endif()
if(M_LIB)
    target_link_libraries(fjs_core PUBLIC ${M_LIB})
endif()
if(NOT MSVC)
    target_compile_options(fjs_core PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

# ---- shared library consumed by Dart FFI ----------------------------------
add_library(fjs SHARED ${FJS_ENGINE_SOURCES})
target_include_directories(fjs PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${FJS_ENGINE_INCLUDE_DIRS}
)
target_compile_definitions(fjs PRIVATE ${FJS_ENGINE_DEFINE})
target_link_libraries(fjs PRIVATE quickjs Threads::Threads)
if(ANDROID)
    find_library(LOG_LIB_FJS log)
    target_link_libraries(fjs PRIVATE ${LOG_LIB_FJS})
endif()
set_target_properties(fjs PROPERTIES
    # fjs_* entry points must stay visible for dart:ffi DynamicLibrary.lookup
    C_VISIBILITY_PRESET default
    CXX_VISIBILITY_PRESET default
)

# ---- pluggable debugger module (spec 090) ---------------------------------
# inspector (CDP semantics) + transport (socket) + attach/detach. Dart opens
# it only in debug builds; release drops the file — Android via
# android/build.gradle's jniLibs exclude, Apple by not force-loading the
# archive. Its engine symbols resolve against the already-loaded libfjs.
if(FJS_DEBUGGER_ENABLED)
    set(FJS_DEBUGGER_SOURCES
        src/debugger-plugin.cpp $<TARGET_OBJECTS:quickjs_inspector>)

    add_library(fjs_debugger SHARED ${FJS_DEBUGGER_SOURCES})
    target_include_directories(fjs_debugger PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/src
        ${FJS_ENGINE_INCLUDE_DIRS}
    )
    target_link_libraries(fjs_debugger PRIVATE fjs)
    if(ANDROID)
        find_library(LOG_LIB_DBG log)
        target_link_libraries(fjs_debugger PRIVATE ${LOG_LIB_DBG})
    endif()

    # Apple ships static slices, so the module is an archive there; nothing
    # references fjs_vm_debugger_attach at link time (Dart looks it up at
    # runtime), which is exactly why a Release link that omits -force_load
    # pulls zero bytes of it into the app binary.
    add_library(fjs_debugger_core STATIC ${FJS_DEBUGGER_SOURCES})
    target_include_directories(fjs_debugger_core PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/src
        ${FJS_ENGINE_INCLUDE_DIRS}
    )
endif()

# ---- host smoke test -------------------------------------------------------
if(FJS_BUILD_TESTS)
    add_executable(fjs-test test/main.cpp)
    target_include_directories(fjs-test PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/tools
        ${FJS_ENGINE_INCLUDE_DIRS})
    # the debugger section of the suite only runs when the module was built
    target_compile_definitions(fjs-test PRIVATE $<$<BOOL:${FJS_DEBUGGER_ENABLED}>:FJS_DEBUGGER>)
    # links the ENGINE only and dlopens the module, so the suite exercises
    # the same "is the debugger shipped?" path the Dart side takes
    target_link_libraries(fjs-test PRIVATE fjs ${CMAKE_DL_LIBS})
    if(FJS_DEBUGGER_ENABLED)
        add_dependencies(fjs-test fjs_debugger)
    endif()
    enable_testing()
    add_test(NAME fjs-core COMMAND fjs-test)
endif()

# ---- fjsc/fjsrun host tools (host only) ------------------------------------
if(NOT ANDROID AND NOT IOS AND NOT FJS_APPLE_STATIC)
    # fjsc is redistributed standalone (npm package `fjsc`), so it stays
    # statically linked — and it never debugs anything.
    add_executable(fjsc tools/fjsc.cpp)
    target_include_directories(fjsc PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
    target_link_libraries(fjsc PRIVATE fjs_core)

    # fjsrun can debug, so it links the engine as a shared library and
    # dlopens the module next to it — same two-step as Dart.
    add_executable(fjsrun tools/fjsrun.cpp)
    target_include_directories(fjsrun PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/tools)
    target_link_libraries(fjsrun PRIVATE fjs ${CMAKE_DL_LIBS})
    if(FJS_DEBUGGER)
        add_dependencies(fjsrun fjs_debugger)
    endif()
endif()
