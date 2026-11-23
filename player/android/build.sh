#!/usr/bin/env bash
set -euo pipefail

workspace=$(cd "$(dirname "$0")/../.." && pwd)
cd "$workspace"
: "${ANDROID_NDK_HOME:?Set the path to Android NDK r27c or later}"
: "${ANDROID_PLATFORM_JAR:?Set the path to the Android 35 android.jar}"
: "${ANDROID_BUILD_TOOLS:?Set the path to Android build-tools 35.0.0}"
: "${SDL_SOURCE:?Set the path to the SDL 3.4.2 source directory}"
: "${JAVA_HOME:?Set the path to JDK 21}"

cart=${1:-web-built/demo.waffle}
output=${2:-web-built/android/GameWaffle-Player.apk}
stage="$workspace/web-built/android/build"
ndk_host=${NDK_HOST_TAG:-linux-x86_64}
toolchain="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$ndk_host/bin"
tools=$ANDROID_BUILD_TOOLS
mkdir -p "$stage/classes" "$stage/dex" "$stage/assets" "$(dirname "$output")"
cp "$cart" "$stage/assets/demo.waffle"

for abi in arm64-v8a x86_64; do
    case "$abi" in
        arm64-v8a) target=aarch64-linux-android; linker_variable=CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER ;;
        x86_64) target=x86_64-linux-android; linker_variable=CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER ;;
    esac
    build="$stage/sdl-$abi"
    cmake -S "$SDL_SOURCE" -B "$build" -G Ninja \
        -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" \
        -DANDROID_ABI="$abi" -DANDROID_PLATFORM=android-24 -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON \
        -DCMAKE_BUILD_TYPE=Release -DSDL_TEST_LIBRARY=OFF -DSDL_TESTS=OFF -DSDL_EXAMPLES=OFF
    cmake --build "$build" --parallel "${JOBS:-4}"
    env "$linker_variable=$toolchain/${target}24-clang" \
        RUSTFLAGS="-L native=$build -C link-arg=-Wl,-z,max-page-size=16384" \
        cargo build --locked --release --lib --manifest-path player/Cargo.toml --target "$target"
    mkdir -p "$stage/lib/$abi"
    cp "$build/libSDL3.so" "$stage/lib/$abi/"
    cp "player/target/$target/release/libmain.so" "$stage/lib/$abi/"
    "$toolchain/llvm-strip" "$stage/lib/$abi/"*.so
done

mapfile -t java_sources < <(find "$SDL_SOURCE/android-project/app/src/main/java/org/libsdl/app" -name '*.java' | sort)
"$JAVA_HOME/bin/javac" -source 8 -target 8 -classpath "$ANDROID_PLATFORM_JAR" -d "$stage/classes" "${java_sources[@]}"
"$JAVA_HOME/bin/jar" cf "$stage/classes.jar" -C "$stage/classes" .
JAVA_HOME="$JAVA_HOME" "$tools/d8" --min-api 24 --lib "$ANDROID_PLATFORM_JAR" --output "$stage/dex" "$stage/classes.jar"
"$tools/aapt2" link -o "$stage/unsigned.apk" -I "$ANDROID_PLATFORM_JAR" \
    --manifest player/android/AndroidManifest.xml -A "$stage/assets"
python3 - "$stage" <<'PY'
import sys
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

stage = Path(sys.argv[1])
with ZipFile(stage / 'unsigned.apk', 'a', compression=ZIP_STORED) as apk:
    for file in sorted((stage / 'dex').glob('classes*.dex')):
        apk.write(file, file.name)
    for file in sorted((stage / 'lib').glob('*/*.so')):
        apk.write(file, file.relative_to(stage).as_posix())
PY
"$tools/zipalign" -P 16 -f 4 "$stage/unsigned.apk" "$stage/aligned.apk"
# Keep the debug key outside the release output.
key="$stage/debug.keystore"
if [[ ! -f "$key" ]]; then
    "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$key" -storepass android -keypass android \
        -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=GameWaffle Debug'
fi
JAVA_HOME="$JAVA_HOME" "$tools/apksigner" sign --ks "$key" --ks-key-alias androiddebugkey \
    --ks-pass pass:android --key-pass pass:android --out "$output" "$stage/aligned.apk"
JAVA_HOME="$JAVA_HOME" "$tools/apksigner" verify "$output"
"$tools/zipalign" -c -P 16 4 "$output"
printf 'Built %s\n' "$output"
