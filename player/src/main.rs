use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
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
    main::run(path, verify)
}
