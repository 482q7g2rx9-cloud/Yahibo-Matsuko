//! 変更履歴：プロジェクトの写し（スナップショット）を、プロジェクトフォルダーの history.sqlite に残す。
//!
//! 写しをいつ残すか・何件残すか・どう戻すかは画面側（apps/editor/src/core/history.ts）が決める。
//! ここは、残す・一覧・取り出す・消すだけを行う。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::state::state;

pub const HISTORY_FILE: &str = "history.sqlite";

/// 開いているプロジェクトの履歴（フォルダーと、つないだデータベース）
#[derive(Default)]
pub struct History(Mutex<Option<(PathBuf, Connection)>>);

/// 一覧に出す情報
#[derive(Debug, Serialize, PartialEq)]
pub struct Info {
    pub id: i64,
    pub at: i64,
    pub kind: String,
    pub summary: String,
}

pub fn open_db(file: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(file)?;
    c.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS snapshots(
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           at INTEGER NOT NULL,
           kind TEXT NOT NULL,
           summary TEXT NOT NULL,
           data TEXT NOT NULL);",
    )?;
    Ok(c)
}

pub fn add(
    c: &Connection,
    at: i64,
    kind: &str,
    summary: &str,
    data: &str,
) -> rusqlite::Result<i64> {
    c.execute(
        "INSERT INTO snapshots(at, kind, summary, data) VALUES (?1, ?2, ?3, ?4)",
        params![at, kind, summary, data],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn list(c: &Connection) -> rusqlite::Result<Vec<Info>> {
    let mut st =
        c.prepare("SELECT id, at, kind, summary FROM snapshots ORDER BY at DESC, id DESC")?;
    let rows = st.query_map([], |r| {
        Ok(Info {
            id: r.get(0)?,
            at: r.get(1)?,
            kind: r.get(2)?,
            summary: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn get(c: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    let mut st = c.prepare("SELECT data FROM snapshots WHERE id = ?1")?;
    let mut rows = st.query(params![id])?;
    Ok(match rows.next()? {
        Some(r) => Some(r.get(0)?),
        None => None,
    })
}

pub fn delete(c: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let mut st = c.prepare("DELETE FROM snapshots WHERE id = ?1")?;
    for id in ids {
        st.execute(params![id])?;
    }
    Ok(())
}

/// 開いているプロジェクトのデータベースで f を行う（プロジェクトが変わっていれば、つなぎ直す）
fn with<T>(
    app: &AppHandle,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let dir = state(app)
        .current()
        .ok_or("プロジェクトが開かれていません")?
        .dir;
    let h = app.state::<History>();
    let mut g = h.0.lock().unwrap();
    if g.as_ref().map(|(d, _)| d != &dir).unwrap_or(true) {
        let c = open_db(&dir.join(HISTORY_FILE))
            .map_err(|e| format!("変更履歴を開けませんでした：{e}"))?;
        *g = Some((dir, c));
    }
    let (_, c) = g.as_ref().unwrap();
    f(c).map_err(|e| format!("変更履歴を読み書きできませんでした：{e}"))
}

#[tauri::command]
pub async fn history_add(
    app: AppHandle,
    at: i64,
    kind: String,
    summary: String,
    project: Value,
) -> Result<i64, String> {
    let data = serde_json::to_string(&project).map_err(|e| e.to_string())?;
    with(&app, |c| add(c, at, &kind, &summary, &data))
}

#[tauri::command]
pub async fn history_list(app: AppHandle) -> Result<Vec<Info>, String> {
    with(&app, list)
}

#[tauri::command]
pub async fn history_get(app: AppHandle, id: i64) -> Result<Value, String> {
    let s = with(&app, |c| get(c, id))?.ok_or("その履歴は見つかりません")?;
    serde_json::from_str(&s).map_err(|e| format!("履歴が壊れています：{e}"))
}

#[tauri::command]
pub async fn history_delete(app: AppHandle, ids: Vec<i64>) -> Result<(), String> {
    with(&app, |c| delete(c, &ids))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_list_get_delete() {
        let dir = std::env::temp_dir().join(format!("matsuko-hist-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let c = open_db(&dir.join(HISTORY_FILE)).unwrap();
        let a = add(&c, 1000, "open", "クリップ 0", "{\"v\":2}").unwrap();
        let b = add(&c, 3000, "auto", "クリップ 2", "{\"v\":2,\"clips\":[]}").unwrap();
        let l = list(&c).unwrap();
        assert_eq!(l.iter().map(|i| i.id).collect::<Vec<_>>(), vec![b, a]);
        assert_eq!(l[0].kind, "auto");
        assert_eq!(get(&c, a).unwrap().unwrap(), "{\"v\":2}");
        delete(&c, &[a]).unwrap();
        assert!(get(&c, a).unwrap().is_none());
        assert_eq!(list(&c).unwrap().len(), 1);
        // 開き直しても残っている
        drop(c);
        let c = open_db(&dir.join(HISTORY_FILE)).unwrap();
        assert_eq!(list(&c).unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }
}
