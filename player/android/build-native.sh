#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
stage="$PWD/web-built/android/build"
toolchain="${ANDROID_NDK_HOME:?Set the Android NDK directory}/toolchains/llvm/prebuilt/${NDK_HOST_TAG:-linux-x86_64}/bin"
: "${SDL_SOURCE:?Set the SDL source directory}"
abi=${1:?Supply arm64-v8a or x86_64}
case "$abi" in
    arm64-v8a) target=aarch64-linux-android; linker_variable=CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER ;;
    x86_64) target=x86_64-linux-android; linker_variable=CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER ;;
    *) echo "Unsupported ABI: $abi" >&2; exit 1 ;;
esac
build="$stage/sdl-$abi"
cmake -S "$SDL_SOURCE" -B "$build" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$abi" -DANDROID_PLATFORM=android-24 -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON \
    -DSDL_SHARED=ON -DSDL_STATIC="$([[ ${BUILD_LIBRETRO:-0} == 1 ]] && echo ON || echo OFF)" \
    -DCMAKE_BUILD_TYPE=Release -DSDL_TEST_LIBRARY=OFF -DSDL_TESTS=OFF -DSDL_EXAMPLES=OFF
cmake --build "$build" --parallel "${JOBS:-4}"
env "$linker_variable=$toolchain/${target}24-clang" \
    RUSTFLAGS="-L native=$build -C link-arg=-Wl,-z,max-page-size=16384" \
    cargo build --locked --release --lib --manifest-path player/Cargo.toml --target "$target"
mkdir -p "$stage/lib/$abi"
cp "$build/libSDL3.so" "$stage/lib/$abi/"
cp "player/target/$target/release/libmain.so" "$stage/lib/$abi/"
"$toolchain/llvm-strip" "$stage/lib/$abi/"*.so
if [[ ${BUILD_LIBRETRO:-0} == 1 ]]; then
    env "$linker_variable=$toolchain/${target}24-clang" \
        RUSTFLAGS="-L native=$build -C link-arg=-Wl,-z,max-page-size=16384" \
        cargo rustc --locked --release --lib --features libretro --manifest-path player/Cargo.toml --target "$target" -- \
        -C link-arg=-landroid -C link-arg=-llog -C link-arg=-lOpenSLES -C link-arg=-lGLESv1_CM -C link-arg=-lGLESv2 -C link-arg=-lEGL -C link-arg=-ldl
    core="player/target/$target/release/libmain.so"
    "$toolchain/llvm-strip" "$core"
    if "$toolchain/llvm-readelf" -d "$core" | grep -q 'NEEDED.*libSDL'; then
        echo 'The core requires a separate SDL library.' >&2
        exit 1
    fi
    python3 packaging/core-zip.py "$core" "android-$abi"
fi
