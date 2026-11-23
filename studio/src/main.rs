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
            let host = app.handle().clone();
            WebviewWindowBuilder::new(
                app,
                "studio",
                WebviewUrl::External(format!("http://127.0.0.1:{port}").parse()?),
            )
            .initialization_script("window.__GAMEWAFFLE_STUDIO__ = true")
            .on_navigation(move |url| {
                if url.scheme() != "http"
                    || !matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
                    || url.path() != "/__playtest"
                {
                    return true;
                }
                let mut game = url.clone();
                game.set_path("/player.html");
                let app = host.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(window) = app.get_webview_window("playtest") {
                        let _ = window.navigate(game);
                        let _ = window.set_focus();
                        return;
                    }
                    let parent = app.clone();
                    let result =
                        WebviewWindowBuilder::new(&app, "playtest", WebviewUrl::External(game))
                            .title("GameWaffle Playtest")
                            .inner_size(960., 640.)
                            .on_navigation(move |next| {
                                if next.path() != "/__stop_playtest" {
                                    return true;
                                }
                                let handle = parent.clone();
                                tauri::async_runtime::spawn(async move {
                                    if let Some(window) = handle.get_webview_window("playtest") {
                                        let _ = window.close();
                                    }
                                    if let Some(editor) = handle.get_webview_window("studio") {
                                        let _ = editor.set_focus();
                                    }
                                });
                                false
                            })
                            .initialization_script("window.__GAMEWAFFLE_PLAYTEST__ = true")
                            .build();
                    if let Err(error) = result {
                        eprintln!("Could not open playtest: {error}");
                    }
                });
                false
            })
            .title("GameWaffle Studio")
            .inner_size(1280., 800.)
            .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "studio" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(game) = window.app_handle().get_webview_window("playtest") {
                    let _ = game.close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start GameWaffle Studio");
}
