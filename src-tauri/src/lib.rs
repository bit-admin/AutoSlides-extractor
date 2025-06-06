use serde::{Deserialize, Serialize};
use tauri::api::dialog::FileDialogBuilder;
use tauri::{Manager, Runtime};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoInfo {
    pub duration: f32,
    pub width: i32,
    pub height: i32,
    pub fps: f32,
    pub codec: String,
}

#[tauri::command]
async fn select_video_file<R: Runtime>(app: tauri::AppHandle<R>) -> Option<String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    FileDialogBuilder::new()
        .add_filter("Video", &["mp4", "avi", "mkv", "mov", "webm"])
        .pick_file(move |file| {
            if let Some(path) = file {
                sender.send(path.to_string_lossy().to_string()).ok();
            } else {
                sender.send(String::new()).ok();
            }
        });
    receiver.recv().ok().and_then(|p| if p.is_empty() { None } else { Some(p) })
}

#[tauri::command]
async fn select_output_dir<R: Runtime>(app: tauri::AppHandle<R>) -> Option<String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    FileDialogBuilder::new().pick_folder(move |folder| {
        if let Some(path) = folder {
            sender.send(path.to_string_lossy().to_string()).ok();
        } else {
            sender.send(String::new()).ok();
        }
    });
    receiver.recv().ok().and_then(|p| if p.is_empty() { None } else { Some(p) })
}

#[tauri::command]
async fn get_video_info(video_path: String) -> Result<VideoInfo, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            &video_path,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let v: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let streams = v["streams"].as_array().ok_or("invalid ffprobe output")?;
    let video_stream = streams
        .iter()
        .find(|s| s["codec_type"] == "video")
        .ok_or("no video stream")?;

    let width = video_stream["width"].as_i64().unwrap_or(0) as i32;
    let height = video_stream["height"].as_i64().unwrap_or(0) as i32;
    let fps = video_stream
        ["r_frame_rate"]
        .as_str()
        .and_then(|s| {
            let mut parts = s.split('/');
            if let (Some(n), Some(d)) = (parts.next(), parts.next()) {
                let n: f32 = n.parse().ok()?;
                let d: f32 = d.parse().ok()?;
                Some(n / d)
            } else {
                None
            }
        })
        .unwrap_or(0.0);
    let codec = video_stream["codec_name"].as_str().unwrap_or("").to_string();
    let duration = v["format"]["duration"].as_str().unwrap_or("0").parse::<f32>().unwrap_or(0.0);

    Ok(VideoInfo {
        duration,
        width,
        height,
        fps,
        codec,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_video_file,
            select_output_dir,
            get_video_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
