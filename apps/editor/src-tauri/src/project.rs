//! プロジェクトフォルダー：`project.json`（自動保存）と `cache/`（プロキシ・サムネイル）。
//!
//! 素材のファイルはコピーせず、フルパスとプロジェクトからの相対パスを保存する。
//! 開くときに素材を探し直し、見つからない素材は画面で「リンクし直す」ようにする。

use std::path::{Path, PathBuf};

use matsuko_core::paths;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::state::{state, OpenProject};

pub const PROJECT_FILE: &str = "project.json";
const RECENT_MAX: usize = 10;

/// 開いたプロジェクト（画面に返す）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub dir: String,
    pub name: String,
    pub project: Value,
    /// 見つからなかった素材の id
    pub missing: Vec<String>,
}

fn err<E: std::fmt::Display>(what: &str) -> impl FnOnce(E) -> String + '_ {
    move |e| format!("{what}：{e}")
}

/// 新しいプロジェクトを置く既定の場所（書類／Matsuko Editor）
fn default_parent(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("Matsuko Editor")
}

#[tauri::command]
pub fn project_default_location(app: AppHandle) -> String {
    default_parent(&app).to_string_lossy().into_owned()
}

/// 新しいプロジェクトの場所をフォルダーの選択で決める
#[tauri::command]
pub async fn project_pick_location(app: AppHandle) -> Option<String> {
    let start = default_parent(&app);
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = a.dialog().file().set_title("プロジェクトを作る場所");
        if start.is_dir() {
            d = d.set_directory(start);
        }
        d.blocking_pick_folder()
    })
    .await
    .ok()??;
    let p = picked.into_path().ok()?;
    state(&app).allowed.lock().unwrap().insert(p.clone());
    Some(p.to_string_lossy().into_owned())
}

/// 同じ名前のフォルダーがあれば「名前 2」「名前 3」…にする
fn unique_dir(parent: &Path, name: &str) -> PathBuf {
    let base = paths::safe_name(name);
    let mut p = parent.join(&base);
    let mut n = 2;
    while p.exists() {
        p = parent.join(format!("{base} {n}"));
        n += 1;
    }
    p
}

/// プロジェクトを新しく作る。`project` は最初に保存する内容（画面の P）
#[tauri::command]
pub async fn project_create(
    app: AppHandle,
    name: String,
    parent: Option<String>,
    project: Value,
) -> Result<Opened, String> {
    let parent = match parent {
        Some(p) => {
            let p = PathBuf::from(p);
            state(&app).check(&p)?;
            p
        }
        None => default_parent(&app),
    };
    let dir = unique_dir(&parent, &name);
    std::fs::create_dir_all(&dir).map_err(err("フォルダーを作れませんでした"))?;
    write_project(&dir, &project)?;
    open_at(&app, &dir)
}

/// 「開く」のダイアログでプロジェクトを選ぶ
#[tauri::command]
pub async fn project_open_dialog(app: AppHandle) -> Result<Option<Opened>, String> {
    let start = default_parent(&app);
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = a
            .dialog()
            .file()
            .set_title("プロジェクトを開く")
            .add_filter("Matsuko Editor のプロジェクト", &["json"]);
        if start.is_dir() {
            d = d.set_directory(start);
        }
        d.blocking_pick_file()
    })
    .await
    .map_err(err("ダイアログを開けませんでした"))?;
    let Some(p) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    open_at(&app, &p).map(Some)
}

/// 起動したときに開くプロジェクト：起動の引数で渡されたもの → 最後に開いたもの
#[tauri::command]
pub async fn project_last(app: AppHandle) -> Option<Opened> {
    let arg = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.exists());
    if let Some(p) = arg {
        if let Ok(o) = open_at(&app, &p) {
            return Some(o);
        }
    }
    for dir in read_recent(&app) {
        if dir.join(PROJECT_FILE).is_file() {
            if let Ok(o) = open_at(&app, &dir) {
                return Some(o);
            }
        }
    }
    None
}

/// 最近開いたプロジェクト（新しい順）
#[tauri::command]
pub fn project_recent(app: AppHandle) -> Vec<Value> {
    read_recent(&app)
        .into_iter()
        .filter(|d| d.join(PROJECT_FILE).is_file())
        .map(|d| json!({"dir": d.to_string_lossy(), "name": dir_name(&d)}))
        .collect()
}

/// 最近開いた一覧から開く（一覧にあるフォルダーだけ）
#[tauri::command]
pub async fn project_open_recent(app: AppHandle, dir: String) -> Result<Opened, String> {
    let d = PathBuf::from(&dir);
    if !read_recent(&app).contains(&d) {
        return Err("最近開いたプロジェクトにありません".into());
    }
    open_at(&app, &d)
}

/// 開いているプロジェクトに保存する（自動保存から呼ぶ）
#[tauri::command]
pub async fn project_save(app: AppHandle, project: Value) -> Result<(), String> {
    let cur = state(&app)
        .current()
        .ok_or("プロジェクトが開かれていません")?;
    write_project(&cur.dir, &project)
}

fn dir_name(d: &Path) -> String {
    d.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "プロジェクト".into())
}

/// 保存する形に整える：画面だけで使う項目を除き、素材の相対パスを入れ直す
pub fn for_disk(dir: &Path, mut project: Value) -> Value {
    if let Some(list) = project.get_mut("media").and_then(Value::as_array_mut) {
        for m in list {
            let Some(o) = m.as_object_mut() else { continue };
            for k in ["url", "loading", "missing", "proxyPath", "job"] {
                o.remove(k);
            }
            let rel = o
                .get("path")
                .and_then(Value::as_str)
                .and_then(|p| paths::relative(dir, Path::new(p)));
            match rel {
                Some(r) => {
                    o.insert("rel".into(), Value::String(r));
                }
                None => {
                    o.remove("rel");
                }
            }
        }
    }
    project
}

/// 途中で止まっても壊れないよう、別のファイルに書いてから入れ替える。前の版は project.json.bak に残す
fn write_project(dir: &Path, project: &Value) -> Result<(), String> {
    let data = serde_json::to_vec(&for_disk(dir, project.clone()))
        .map_err(err("保存する内容を作れませんでした"))?;
    let file = dir.join(PROJECT_FILE);
    let tmp = dir.join("project.json.tmp");
    std::fs::write(&tmp, &data).map_err(err("保存できませんでした"))?;
    if file.is_file() {
        let _ = std::fs::copy(&file, dir.join("project.json.bak"));
    }
    std::fs::rename(&tmp, &file).map_err(err("保存できませんでした"))
}

/// プロジェクトを開き、素材を探し直す
pub fn open_at(app: &AppHandle, path: &Path) -> Result<Opened, String> {
    let dir = if path.is_file() {
        path.parent().map(Path::to_path_buf).unwrap_or_default()
    } else {
        path.to_path_buf()
    };
    let text = std::fs::read_to_string(dir.join(PROJECT_FILE))
        .map_err(err("プロジェクトを開けませんでした"))?;
    let mut project: Value =
        serde_json::from_str(&text).map_err(err("プロジェクトのファイルが壊れています"))?;
    if !project.get("media").map(Value::is_array).unwrap_or(false) {
        return Err("Matsuko Editor のプロジェクトではありません".into());
    }
    let st = state(app);
    st.cancel_all();
    let open = OpenProject { dir: dir.clone() };
    for sub in ["proxy", "thumb"] {
        let _ = std::fs::create_dir_all(open.cache(sub));
    }
    st.allow_dir(app, &open.cache(""));
    // 途中で終了したときの作りかけのプロキシを片付ける（開いたあと、もう一度作る）
    if let Ok(rd) = std::fs::read_dir(open.cache("proxy")) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().contains(".part.") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }

    let mut missing = Vec::new();
    let mut moved = false;
    if let Some(list) = project.get_mut("media").and_then(Value::as_array_mut) {
        for m in list {
            let Some(o) = m.as_object_mut() else { continue };
            if o.get("file").and_then(Value::as_u64).unwrap_or(0) != 1 {
                continue;
            }
            let id = o
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let abs = o.get("path").and_then(Value::as_str).map(str::to_string);
            let rel = o.get("rel").and_then(Value::as_str).map(str::to_string);
            let f = o.get("f").and_then(Value::as_str).unwrap_or("").to_string();
            match paths::resolve(&dir, abs.as_deref(), rel.as_deref(), &f) {
                Some(p) => {
                    st.allow(app, &p);
                    let now = p.to_string_lossy().into_owned();
                    moved |= abs.as_deref() != Some(now.as_str());
                    o.insert("path".into(), Value::String(now));
                }
                None => {
                    o.insert("missing".into(), json!(1));
                    missing.push(id.clone());
                }
            }
            for ext in ["mp4", "webm", "m4a"] {
                let px = open.cache("proxy").join(format!("{id}.{ext}"));
                if px.is_file() {
                    o.insert(
                        "proxyPath".into(),
                        Value::String(px.to_string_lossy().into_owned()),
                    );
                    break;
                }
            }
        }
    }
    // フォルダーごと移したなどで素材の場所が変わったら、すぐ書き直しておく
    if moved {
        let _ = write_project(&dir, &project);
    }
    *st.project.lock().unwrap() = Some(open);
    push_recent(app, &dir);
    let _ = app
        .get_webview_window("main")
        .map(|w| w.set_title(&format!("{} — Matsuko Editor", dir_name(&dir))));
    Ok(Opened {
        dir: dir.to_string_lossy().into_owned(),
        name: dir_name(&dir),
        project,
        missing,
    })
}

fn recent_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("recent.json"))
}

fn read_recent(app: &AppHandle) -> Vec<PathBuf> {
    recent_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

fn push_recent(app: &AppHandle, dir: &Path) {
    let Some(f) = recent_file(app) else { return };
    let mut list: Vec<PathBuf> = read_recent(app).into_iter().filter(|d| d != dir).collect();
    list.insert(0, dir.to_path_buf());
    list.truncate(RECENT_MAX);
    let s: Vec<String> = list
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if let Some(parent) = f.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(f, serde_json::to_string(&s).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disk_form_strips_ui_fields_and_adds_rel() {
        let dir = Path::new("/p/proj");
        let v = json!({"media":[{"id":"m1","path":"/p/clips/a.mp4","url":"asset://x","loading":1,"missing":1,"proxyPath":"/p/proj/cache/proxy/m1.mp4"},{"id":"m2"}]});
        let out = for_disk(dir, v);
        let m = &out["media"][0];
        assert_eq!(m["rel"], "../clips/a.mp4");
        assert!(
            m.get("url").is_none() && m.get("missing").is_none() && m.get("proxyPath").is_none()
        );
        assert!(out["media"][1].get("rel").is_none());
    }

    #[test]
    fn unique_names() {
        let tmp = std::env::temp_dir().join(format!("matsuko-uniq-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("番組")).unwrap();
        assert_eq!(unique_dir(&tmp, "番組"), tmp.join("番組 2"));
        assert_eq!(unique_dir(&tmp, "a/b"), tmp.join("a_b"));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
