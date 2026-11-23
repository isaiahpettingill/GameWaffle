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
# Fetch independent archives together. Verify each archive before APT uses it.
# The runner deletes its APT archive directory at the end of the job.
prefetch() {
    local plan
    plan=$("${apt[@]}" --print-uris "${install[@]}") || return 1
    awk -F "'" '/^\047/ {print $2, $3}' <<<"$plan" |
        xargs -r -n 4 -P 12 bash -ec '
            url=$1 file=$2 digest=$4
            [[ "$file" != */* && "$digest" == *:* ]]
            # Each apt-helper process would otherwise rewrite the same mirror list.
            case "$url" in mirror+file:*/pool/*) url="https://archive.ubuntu.com/ubuntu/pool/${url#*/pool/}";; esac
            sudo /usr/lib/apt/apt-helper -o Acquire::https::Timeout=20 download-file "$url" "/var/cache/apt/archives/$file" "$digest"
        ' _
}
# Hosted runner indices can point to package versions that Ubuntu has removed.
"${apt[@]}" update
prefetch || true
"${apt[@]}" "${install[@]}"
