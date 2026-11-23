#!/usr/bin/env bash
set -euo pipefail
umask 077
key=${1:?Supply a new .p12 path outside the repository}
[[ ! -e "$key" ]] || { echo 'Choose a new key file.' >&2; exit 1; }
gh auth status >/dev/null
read -rsp 'New keystore password (save it with your backup): ' GW_KEY_PASSWORD
echo
export GW_KEY_PASSWORD
keytool -genkeypair -storetype PKCS12 -keystore "$key" -storepass:env GW_KEY_PASSWORD -alias gamewaffle -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=GameWaffle'
python3 - "$key" <<'PY' | gh secret set ANDROID_SIGNING -R isaiahpettingill/GameWaffle
import base64,json,os,sys
from pathlib import Path
print(json.dumps(dict(key=base64.b64encode(Path(sys.argv[1]).read_bytes()).decode(),password=os.environ['GW_KEY_PASSWORD'])))
PY
