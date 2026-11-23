use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn version(tag: &str) -> Option<(u32, u32, u32)> {
    let mut parts = tag.strip_prefix('v')?.split('.');
    let mut next = || parts.next()?.parse().ok();
    let v = (next()?, next()?, next()?);
    parts.next().is_none().then_some(v)
}

// Only the Studio installation has a release marker. Exported games keep their own player.
pub fn installed_player(exe: &Path) -> Option<PathBuf> {
    let shipped = fs::read_to_string(exe.with_file_name("release-version")).ok()?;
    let (base, target) = if cfg!(target_os = "windows") {
        (PathBuf::from(env::var_os("LOCALAPPDATA")?), "windows-x64")
    } else if cfg!(target_os = "linux") {
        (
            env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| Some(PathBuf::from(env::var_os("HOME")?).join(".local/share")))?,
            "linux-x64",
        )
    } else {
        return None;
    };
    let dir = base.join("GameWaffle/updates").join(target);
    let current = fs::read_to_string(dir.join("current")).ok()?;
    if version(&current)? <= version(shipped.trim())? {
        return None;
    }
    let player = dir.join(current).join(exe.file_name()?);
    player.is_file().then_some(player)
}
