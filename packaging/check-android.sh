#!/usr/bin/env bash
set -euo pipefail
app=org.gamewaffle.player
adb install -r GameWaffle-Player.apk
adb logcat -c
adb shell am start -W -n "$app/org.libsdl.app.SDLActivity"
# The native SDL loop must continue after activity creation.
for n in {1..10}; do
  if adb shell dumpsys activity activities | grep -F "$app/org.libsdl.app.SDLActivity" >/dev/null && adb shell pidof "$app" >/dev/null; then break; fi
  sleep 1
done
sleep 3
adb shell pidof "$app" >/dev/null
adb exec-out screencap -p > android-frame.png
python3 - <<'PYSCREEN'
from PIL import Image
from collections import Counter
colors=Counter(Image.open('android-frame.png').convert('RGB').getdata())
targets=[(23,24,41),(52,49,76),(255,200,117),(146,218,196),(189,166,237),(238,158,159)]
def present(target):
    return any(n>=8 and all(abs(a-b)<=4 for a,b in zip(rgb,target)) for rgb,n in colors.items())
assert sum(map(present,targets))>=3, 'The emulator did not display the Basalt Works room'
PYSCREEN
adb shell input keyevent KEYCODE_F5
sleep 1
adb shell input keyevent KEYCODE_F2
adb shell input keyevent KEYCODE_F9
adb shell input keyevent KEYCODE_F4
sleep 1
adb shell pidof "$app" >/dev/null
adb logcat -b crash -d > android-crashes.txt
if grep -F "$app" android-crashes.txt; then exit 1; fi

ndk=${ANDROID_NDK_LATEST_HOME:-${ANDROID_NDK_HOME:?Set the Android NDK directory}}
"$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android24-clang" \
    packaging/check-android-core.c -ldl -o android-core-check
unzip -p GameWaffle-Libretro-android-x86_64.zip gamewaffle_libretro.so > gamewaffle_libretro.so
unzip -p GameWaffle-Player.apk assets/demo.waffle > android-demo.waffle
adb push android-core-check gamewaffle_libretro.so android-demo.waffle /data/local/tmp/
adb shell 'cd /data/local/tmp && chmod 755 android-core-check && ./android-core-check ./gamewaffle_libretro.so android-demo.waffle'
