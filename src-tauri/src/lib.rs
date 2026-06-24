use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Keeps the Node/Bun sidecar process handle so we can kill it on exit.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Extract `(base, token)` from the sidecar's "Dashboard: http://127.0.0.1:PORT/?token=…" line.
fn parse_dashboard(line: &str) -> Option<(String, String)> {
    let start = line.find("http://")?;
    let rest = &line[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let url = rest[..end].trim(); // http://127.0.0.1:PORT/?token=TOKEN
    let token = url.split("token=").nth(1)?.trim().to_string();
    let base = url.split("/?").next()?.to_string(); // http://127.0.0.1:PORT
    if token.is_empty() {
        return None;
    }
    Some((base, token))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Launch the bundled server (sidecar). It picks a free port + token and
            // prints the dashboard URL; the SPA itself is served by Tauri.
            let (mut rx, child) = app
                .shell()
                .sidecar("tokenflow")?
                .args(["--no-open", "--host", "127.0.0.1"])
                .spawn()?;
            app.manage(Sidecar(Mutex::new(Some(child))));

            // Wait for the server to report its URL + token (readiness signal).
            let mut info: Option<(String, String)> = None;
            while let Some(event) = rx.blocking_recv() {
                match &event {
                    CommandEvent::Stdout(bytes) => {
                        if let Some(parsed) = parse_dashboard(&String::from_utf8_lossy(bytes)) {
                            info = Some(parsed);
                            break;
                        }
                    }
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }
            let (base, token) = info.ok_or("the Token Flow Manager server did not start")?;

            // Inject the server origin + token before the SPA boots, then open it.
            let script = format!("window.__TFM__={{api:{base:?},token:{token:?}}};");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Token Flow Manager")
                .inner_size(1320.0, 860.0)
                .min_inner_size(900.0, 600.0)
                .initialization_script(&script)
                .build()?;

            // Drain the rest of the sidecar's output so its pipe never blocks.
            tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<Sidecar>() {
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
