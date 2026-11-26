//! アプリ全体で持つ状態：開いているプロジェクト、画面から触ってよいファイル、動いている作業。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tokio::sync::{watch, Semaphore};

/// 開いているプロジェクト
#[derive(Debug, Clone)]
pub struct OpenProject {
    /// プロジェクトフォルダー
    pub dir: PathBuf,
}

impl OpenProject {
    pub fn cache(&self, sub: &str) -> PathBuf {
        self.dir.join("cache").join(sub)
    }
}

pub struct AppState {
    pub project: Mutex<Option<OpenProject>>,
    /// 画面から渡されたパスのうち、使ってよいもの（ダイアログで選んだ・ドロップした・プロジェクトにある）
    pub allowed: Mutex<HashSet<PathBuf>>,
    /// 画面へ丸ごと渡してよいフォルダー（プロジェクトの cache/）
    pub dirs: Mutex<HashSet<PathBuf>>,
    /// 保存のダイアログで選ばれた書き出し先（ここにだけ書ける）
    pub save_target: Mutex<Option<PathBuf>>,
    /// 動いている作業（「素材id:種類」→ 中止の合図）
    pub jobs: Mutex<HashMap<String, watch::Sender<bool>>>,
    /// プロキシは重いので1つずつ、サムネイル・波形は2つまで同時に
    pub heavy: Semaphore,
    pub light: Semaphore,
    /// 使えるプロキシのエンコーダー（初回に調べる）
    pub encoders: tokio::sync::OnceCell<Vec<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: Mutex::new(None),
            allowed: Mutex::new(HashSet::new()),
            dirs: Mutex::new(HashSet::new()),
            save_target: Mutex::new(None),
            jobs: Mutex::new(HashMap::new()),
            heavy: Semaphore::new(1),
            light: Semaphore::new(2),
            encoders: tokio::sync::OnceCell::new(),
        }
    }
}

impl AppState {
    pub fn current(&self) -> Option<OpenProject> {
        self.project.lock().unwrap().clone()
    }

    /// ファイルを使ってよい一覧に入れ、画面（asset:）から読めるようにする
    pub fn allow(&self, app: &AppHandle, p: &Path) {
        self.allowed.lock().unwrap().insert(p.to_path_buf());
        let _ = app.asset_protocol_scope().allow_file(p);
    }

    pub fn allow_dir(&self, app: &AppHandle, p: &Path) {
        self.dirs.lock().unwrap().insert(p.to_path_buf());
        let _ = app.asset_protocol_scope().allow_directory(p, true);
    }

    /// 画面へ渡してよいファイルか（使ってよいファイル、または cache/ の中。`..` を含むものは渡さない）
    pub fn served(&self, p: &Path) -> bool {
        if p.components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return false;
        }
        if self.allowed.lock().unwrap().contains(p) {
            return true;
        }
        let dirs = self.dirs.lock().unwrap();
        p.ancestors().skip(1).any(|a| dirs.contains(a))
    }

    /// 画面から渡されたパスを使ってよいか
    pub fn check(&self, p: &Path) -> Result<(), String> {
        if self.allowed.lock().unwrap().contains(p) {
            Ok(())
        } else {
            Err(format!("このファイルは開けません：{}", p.display()))
        }
    }

    /// すべての作業を止める（プロジェクトを切り替えるとき・終了するとき）
    pub fn cancel_all(&self) {
        for (_, tx) in self.jobs.lock().unwrap().drain() {
            let _ = tx.send(true);
        }
    }
}

pub fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}
