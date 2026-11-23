#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
struct Host(Mutex<Child>);
impl Drop for Host {
    fn drop(&mut self) {
        if let Ok(child) = self.0.get_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let exe = std::env::current_exe()?;
            let dir = exe.parent().ok_or("Missing install directory")?;
            let root = if dir.join("src/server.mjs").is_file() {
                dir.to_owned()
            } else {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
            };
            let bundled = root.join(if cfg!(windows) { "node.exe" } else { "node" });
            let mut command = Command::new(if bundled.is_file() {
                bundled
            } else {
                PathBuf::from("node")
            });
            command
                .current_dir(root)
                .args(["src/server.mjs", "--port", "0"])
                .args(std::env::args_os().skip(1))
                .env("GW_PARENT_PIPE", "1")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command.spawn()?;
            let output = child.stdout.take().ok_or("Missing Studio output")?;
            app.manage(Host(Mutex::new(child)));
            let line = BufReader::new(output)
                .lines()
                .next()
                .ok_or("Studio host exited during startup")??;
            let port: u16 = line
                .rsplit(':')
                .next()
                .ok_or("Missing Studio port")?
                .parse()?;
            WebviewWindowBuilder::new(
                app,
                "studio",
                WebviewUrl::External(format!("http://127.0.0.1:{port}").parse()?),
            )
            .title("GameWaffle Studio")
            .inner_size(1280., 800.)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Could not start GameWaffle Studio");
}
