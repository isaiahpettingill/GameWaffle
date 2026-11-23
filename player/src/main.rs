mod update;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(player) = std::env::current_exe()
        .ok()
        .and_then(|exe| update::installed_player(&exe))
    {
        let status = std::process::Command::new(player)
            .args(std::env::args_os().skip(1))
            .status()?;
        std::process::exit(status.code().unwrap_or(1));
    }
    let mut path = None;
    let mut verify = false;
    for arg in std::env::args_os().skip(1) {
        if arg == "--verify" {
            verify = true;
        } else if path.is_none() {
            path = Some(PathBuf::from(arg));
        } else {
            return Err("Usage: gamewaffle-player [--verify] [cartridge.waffle]".into());
        }
    }
    if path.is_none() {
        if let Ok(exe) = std::env::current_exe() {
            let game = exe.with_file_name("game.waffle");
            if game.is_file() {
                path = Some(game);
            }
        }
    }
    main::run(path, verify)
}
