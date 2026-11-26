//! 同梱した FFmpeg・ffprobe の起動。
//!
//! 配布版では実行ファイルと同じフォルダーに置かれる（tauri.conf.json の externalBin）。
//! `tauri dev` でも target/debug にコピーされる。テストでは MATSUKO_FFMPEG_DIR で場所を変えられる。
//! 波形のためにバイナリの出力をそのまま読みたいので、shell プラグインではなく tokio のプロセスを使う。

use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

/// ツール（ffmpeg / ffprobe）の場所
pub fn tool_path(name: &str) -> PathBuf {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    if let Some(dir) = std::env::var_os("MATSUKO_FFMPEG_DIR") {
        return PathBuf::from(dir).join(file);
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    {
        let p = dir.join(&file);
        if p.is_file() {
            return p;
        }
    }
    // 見つからなければ PATH にあるものを使う（開発用）
    PathBuf::from(file)
}

/// 画面を出さずに、出力を受け取れる形でツールを起動する準備をする
pub fn command(name: &str) -> Command {
    let mut c = Command::new(tool_path(name));
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // コンソールの窓を出さない（CREATE_NO_WINDOW）
        c.creation_flags(0x0800_0000);
    }
    c
}

/// `-version` の1行目（例：「ffmpeg version 7.1.1」）
pub async fn version(name: &str) -> Option<String> {
    let out = command(name).arg("-version").output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().next()?;
    Some(
        line.split(" Copyright")
            .next()
            .unwrap_or(line)
            .trim()
            .to_string(),
    )
}

/// エラー出力の最後の数行（失敗の理由を画面に出すため）
pub fn tail(stderr: &[u8]) -> String {
    let s = String::from_utf8_lossy(stderr);
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(3)..].join(" / ")
}
