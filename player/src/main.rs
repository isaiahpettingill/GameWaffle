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
    let mut network = None;
    let mut args = std::env::args_os().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--host" || arg == "--join" {
            let address = args
                .next()
                .ok_or("Supply an IP address and port")?
                .into_string()
                .map_err(|_| "Invalid address")?;
            let guests = if arg == "--host" {
                Some(
                    args.next()
                        .ok_or("Supply the remote player count")?
                        .to_string_lossy()
                        .parse::<usize>()?,
                )
            } else {
                None
            };
            network = Some((address, guests));
            continue;
        }
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
    main::run_network(path, verify, network)
}
