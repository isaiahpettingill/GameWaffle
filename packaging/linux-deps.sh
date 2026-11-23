#!/usr/bin/env bash
set -euo pipefail

packages=(
    libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev
    libasound2-dev libpulse-dev libx11-dev libxext-dev libxrandr-dev libxcursor-dev
    libxi-dev libxfixes-dev libxss-dev libxtst-dev libxkbcommon-dev libwayland-dev
    libdecor-0-dev libdrm-dev libgbm-dev libegl-dev libgl-dev libudev-dev libdbus-1-dev
)
if [[ ${1:-build} == package ]]; then
    packages=(squashfs-tools)
    if [[ ${2:-} == --launch ]]; then packages+=(xvfb xauth xdotool libwebkit2gtk-4.1-0 libayatana-appindicator3-1); fi
fi

missing=()
for package in "${packages[@]}"; do
    if [[ $(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true) != installed ]]; then
        missing+=("$package")
    fi
done
if (( ${#missing[@]} == 0 )); then exit 0; fi

# All build dependencies come from Ubuntu. Ignore unrelated third-party feeds.
apt=(sudo apt-get -o Acquire::Retries=2 -o Dpkg::Use-Pty=0)
if [[ -f /etc/apt/sources.list.d/ubuntu.sources ]]; then
    apt+=(-o Dir::Etc::sourcelist=/etc/apt/sources.list.d/ubuntu.sources -o Dir::Etc::sourceparts=-)
fi
install=(install -y --no-install-recommends "${missing[@]}")
if ! "${apt[@]}" "${install[@]}"; then
    "${apt[@]}" update
    "${apt[@]}" "${install[@]}"
fi
