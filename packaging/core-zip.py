"""Put a core and its RetroArch menu entry in one platform archive."""
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile

binary, platform = Path(sys.argv[1]), sys.argv[2]
with ZipFile(f'GameWaffle-Libretro-{platform}.zip', 'w', ZIP_DEFLATED) as archive:
    archive.write(binary, 'gamewaffle_libretro' + binary.suffix)
    archive.write('player/libretro/gamewaffle_libretro.info', 'gamewaffle_libretro.info')
    archive.write('LICENSE')
