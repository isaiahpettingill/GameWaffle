#!/usr/bin/env bash
set -euo pipefail

workspace=$(cd "$(dirname "$0")/../.." && pwd)
cd "$workspace"
: "${ANDROID_PLATFORM_JAR:?Set the path to the Android 35 android.jar}"
: "${ANDROID_BUILD_TOOLS:?Set the path to Android build-tools 35.0.0}"
: "${SDL_SOURCE:?Set the path to the SDL 3.4.2 source directory}"
: "${JAVA_HOME:?Set the path to JDK 21}"

output=${1:-web-built/android/GameWaffle-Player.apk}
stage="$workspace/web-built/android/build"
tools=$ANDROID_BUILD_TOOLS
mkdir -p "$stage/classes" "$stage/dex" "$(dirname "$output")"

for abi in arm64-v8a x86_64; do
    if [[ ${USE_PREBUILT_ANDROID_LIBS:-0} == 1 ]]; then
        for library in libmain.so libSDL3.so; do
            test -s "$stage/lib/$abi/$library" || { echo "Missing $abi/$library" >&2; exit 1; }
        done
    else
        bash player/android/build-native.sh "$abi"
    fi
done

mapfile -t java_sources < <(find "$SDL_SOURCE/android-project/app/src/main/java/org/libsdl/app" player/android/java -name '*.java' | sort)
"$JAVA_HOME/bin/javac" -source 8 -target 8 -classpath "$ANDROID_PLATFORM_JAR" -d "$stage/classes" "${java_sources[@]}"
"$JAVA_HOME/bin/jar" cf "$stage/classes.jar" -C "$stage/classes" .
JAVA_HOME="$JAVA_HOME" "$tools/d8" --min-api 24 --lib "$ANDROID_PLATFORM_JAR" --output "$stage/dex" "$stage/classes.jar"
mkdir -p "$stage/res/drawable-nodpi"
cp studio/icons/icon.png "$stage/res/drawable-nodpi/gamewaffle.png"
cp -R player/android/res/. "$stage/res/"
"$tools/aapt2" compile --dir "$stage/res" -o "$stage/resources.zip"
"$tools/aapt2" link --version-code "${RELEASE_VERSION_CODE:-1}" --version-name "${RELEASE_VERSION_NAME:-0.1.0}" -o "$stage/unsigned.apk" -I "$ANDROID_PLATFORM_JAR" \
    --manifest player/android/AndroidManifest.xml "$stage/resources.zip"
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
if [[ -n ${ANDROID_KEYSTORE:-} ]]; then
    key=$ANDROID_KEYSTORE
    alias=gamewaffle
    : "${GW_KEY_PASSWORD:?Set the keystore password}"
else
    key="$stage/debug.keystore"
    alias=androiddebugkey
    export GW_KEY_PASSWORD=android
    if [[ ! -f "$key" ]]; then
        "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$key" -storepass:env GW_KEY_PASSWORD \
            -alias "$alias" -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=GameWaffle Debug'
    fi
fi
JAVA_HOME="$JAVA_HOME" "$tools/apksigner" sign --ks "$key" --ks-key-alias "$alias" \
    --ks-pass env:GW_KEY_PASSWORD --out "$output" "$stage/aligned.apk"
JAVA_HOME="$JAVA_HOME" "$tools/apksigner" verify "$output"
"$tools/zipalign" -c -P 16 4 "$output"
printf 'Built %s\n' "$output"
