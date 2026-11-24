#!/usr/bin/env bash
set -euo pipefail
app=org.gamewaffle.player
apk=${1:-GameWaffle-Player.apk}
fixture=web-built/demo.waffle
if [[ $(adb shell getprop ro.kernel.qemu | tr -d '\r') != 1 ]]; then
  echo 'Run this check on the Android emulator.' >&2
  exit 1
fi
if unzip -Z1 "$apk" | awk '/\.waffle$/ { found=1 } END { exit !found }'; then
  echo 'The player APK contains a cartridge.' >&2
  exit 1
fi
adb install -r "$apk"
adb shell pm clear "$app"
adb logcat -c
adb shell mkdir -p /sdcard/Download/GameWaffleTest/Fixtures
adb push "$fixture" /sdcard/Download/GameWaffleTest/Fixtures/Smoke.waffle
adb shell am start -W -n "$app/.LibraryActivity"
python3 - <<'PYLIBRARY'
import re
import subprocess
import time
import xml.etree.ElementTree as ET

def adb(*args):
    return subprocess.check_output(['adb', *args], timeout=20)

def wait(label, click=False, attempts=8):
    for _ in range(attempts):
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/gamewaffle-test.xml')
            xml = ET.fromstring(adb('exec-out', 'cat', '/sdcard/gamewaffle-test.xml'))
            for node in xml.iter('node'):
                if label.casefold() in [node.get(key, '').casefold() for key in ('text', 'content-desc')]:
                    if node.get('enabled') != 'true':
                        continue
                    x0, y0, x1, y1 = map(int, re.findall(r'\d+', node.get('bounds')))
                    if click:
                        adb('shell', 'input', 'tap', str((x0 + x1) // 2), str((y0 + y1) // 2))
                    return x0, y0, x1, y1
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ET.ParseError):
            pass
        time.sleep(.5)
    raise AssertionError('Missing Android UI label: ' + label)

wait('Choose the folder that contains your cartridges.')
wait('Choose folder', click=True)
for _ in range(6):
    try:
        wait('Download', click=True, attempts=1)
        break
    except AssertionError:
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
wait('GameWaffleTest', click=True)
wait('Use this folder', click=True)
wait('Allow', click=True)
wait('Basalt Works', click=True)
display = wait('Game display')
gamepad = wait('Touch gamepad')
assert display[3] <= gamepad[1], 'The portrait gamepad overlaps gameplay'
PYLIBRARY
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
sleep 1
adb shell pidof "$app" >/dev/null
adb logcat -b crash -d > android-crashes.txt
if grep -F "$app" android-crashes.txt; then exit 1; fi

ndk=${ANDROID_NDK_LATEST_HOME:-${ANDROID_NDK_HOME:?Set the Android NDK directory}}
"$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android24-clang" \
    packaging/check-android-core.c -ldl -o android-core-check
unzip -p GameWaffle-Libretro-android-x86_64.zip gamewaffle_libretro.so > gamewaffle_libretro.so
adb push android-core-check gamewaffle_libretro.so /data/local/tmp/
adb push "$fixture" /data/local/tmp/android-demo.waffle
adb shell 'cd /data/local/tmp && chmod 755 android-core-check && timeout 60s ./android-core-check ./gamewaffle_libretro.so android-demo.waffle'
