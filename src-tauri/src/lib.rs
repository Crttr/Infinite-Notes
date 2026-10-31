use std::path::{Path, PathBuf};

fn check_inotes(path: &Path) -> Result<(), String> {
    if path.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("inotes")) != Some(true) {
        return Err("Выберите файл с расширением .inotes".into());
    }
    Ok(())
}

#[tauri::command]
async fn choose_inotes_save_path(default_name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let safe: String = default_name.chars().map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
        let name = if safe.trim().is_empty() { "InfiniteNotes" } else { safe.trim() };
        let path = rfd::FileDialog::new().add_filter("Infinite Notes", &["inotes"])
            .set_file_name(format!("{}.inotes", name)).save_file();
        path.map(|p| { check_inotes(&p)?; Ok(p.to_string_lossy().to_string()) }).transpose()
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn choose_inotes_open_path() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new().add_filter("Infinite Notes", &["inotes"]).pick_file();
        path.map(|p| { check_inotes(&p)?; Ok(p.to_string_lossy().to_string()) }).transpose()
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_inotes_file(path: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        check_inotes(&path)?;
        let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if size > 512 * 1024 * 1024 { return Err("Файл превышает 512 МБ".into()); }
        std::fs::read(path).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn write_inotes_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        check_inotes(&path)?;
        if bytes.len() > 512 * 1024 * 1024 { return Err("Файл превышает 512 МБ".into()); }
        // Write into a sibling temporary file first to avoid truncating a valid project on failure.
        let temporary = path.with_extension("inotes.tmp");
        std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        if path.exists() {
            // Windows does not support rename-over-existing; keep the original intact until the new file is ready.
            let backup = path.with_extension("inotes.previous");
            if backup.exists() { std::fs::remove_file(&backup).map_err(|e| e.to_string())?; }
            std::fs::rename(&path, &backup).map_err(|e| e.to_string())?;
            if let Err(e) = std::fs::rename(&temporary, &path) {
                let _ = std::fs::rename(&backup, &path);
                return Err(e.to_string());
            }
            let _ = std::fs::remove_file(&backup);
        } else {
            std::fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![choose_inotes_save_path, choose_inotes_open_path, read_inotes_file, write_inotes_file])
        .run(tauri::generate_context!())
        .expect("error while running Infinite Notes");
}
