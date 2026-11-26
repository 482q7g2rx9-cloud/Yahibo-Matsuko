//! macOS のメニューバー：画面の中のメニュー（ファイル・編集・表示・プロジェクト・ヘルプ）を、Mac のメニューバーに出す。
//!
//! メニューの中身（項目・チェック・ショートカット）は画面が組み立てて送る（menu_set）。
//! 項目を選ぶと "menu-action" で画面に知らせ、画面のメニューと同じ動作をする。
//! macOS 以外では何もしない（画面の中のメニューバーを使う）。どの OS でもコンパイルはする。

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Wry};

#[derive(Debug, Deserialize)]
pub struct MenuSpec {
    pub label: String,
    pub items: Vec<ItemSpec>,
}

#[derive(Debug, Deserialize)]
pub struct ItemSpec {
    /// item（ふつうの項目）・check（チェックつき）・sep（区切り）・head（見出し。選べない）・native（Mac の標準の項目）
    pub kind: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    /// ショートカット（例：CmdOrCtrl+Shift+Z）。⌘ を使うものだけ
    #[serde(default)]
    pub accel: Option<String>,
    #[serde(default)]
    pub checked: bool,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

const APP: &str = "Matsuko Editor";

/// Mac の標準の項目（コピー・切り取り・貼り付け・すべて選択）。文字の入力欄ではその文字に、ほかでは画面が受けてクリップに働く
fn native(app: &AppHandle, id: &str, label: &str) -> tauri::Result<PredefinedMenuItem<Wry>> {
    let t = Some(label);
    match id {
        "copy" => PredefinedMenuItem::copy(app, t),
        "cut" => PredefinedMenuItem::cut(app, t),
        "paste" => PredefinedMenuItem::paste(app, t),
        _ => PredefinedMenuItem::select_all(app, t),
    }
}

fn build(app: &AppHandle, menus: &[MenuSpec]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    // アプリの名前のメニュー
    let a = Submenu::new(app, APP, true)?;
    a.append(&MenuItem::with_id(
        app,
        "about",
        format!("{APP} について"),
        true,
        None::<&str>,
    )?)?;
    a.append(&PredefinedMenuItem::separator(app)?)?;
    a.append(&MenuItem::with_id(
        app,
        "prefs",
        "環境設定…",
        true,
        Some("CmdOrCtrl+Comma"),
    )?)?;
    a.append(&PredefinedMenuItem::separator(app)?)?;
    a.append(&PredefinedMenuItem::services(app, Some("サービス"))?)?;
    a.append(&PredefinedMenuItem::separator(app)?)?;
    a.append(&PredefinedMenuItem::hide(
        app,
        Some(&format!("{APP} を隠す")),
    )?)?;
    a.append(&PredefinedMenuItem::hide_others(app, Some("ほかを隠す"))?)?;
    a.append(&PredefinedMenuItem::show_all(app, Some("すべてを表示"))?)?;
    a.append(&PredefinedMenuItem::separator(app)?)?;
    a.append(&PredefinedMenuItem::quit(
        app,
        Some(&format!("{APP} を終了")),
    )?)?;
    menu.append(&a)?;
    for (n, m) in menus.iter().enumerate() {
        let s = Submenu::new(app, &m.label, true)?;
        for (i, it) in m.items.iter().enumerate() {
            // 同じ動作の項目がいくつあってもよいよう、id には位置を付けて区別する（画面には元の id を返す）
            let id = format!("{n}.{i}|{}", it.id);
            match it.kind.as_str() {
                "sep" => s.append(&PredefinedMenuItem::separator(app)?)?,
                "head" => s.append(&MenuItem::with_id(app, id, &it.label, false, None::<&str>)?)?,
                "native" => s.append(&native(app, &it.id, &it.label)?)?,
                "check" => s.append(&CheckMenuItem::with_id(
                    app,
                    id,
                    &it.label,
                    it.enabled,
                    it.checked,
                    it.accel.as_deref(),
                )?)?,
                _ => s.append(&MenuItem::with_id(
                    app,
                    id,
                    &it.label,
                    it.enabled,
                    it.accel.as_deref(),
                )?)?,
            }
        }
        // 「ヘルプ」の前に、Mac の標準の「ウインドウ」メニューを入れる
        if n + 2 == menus.len() {
            let w = Submenu::new(app, "ウインドウ", true)?;
            w.append(&PredefinedMenuItem::minimize(app, Some("しまう"))?)?;
            w.append(&PredefinedMenuItem::maximize(app, Some("拡大／縮小"))?)?;
            w.append(&PredefinedMenuItem::fullscreen(
                app,
                Some("フルスクリーンにする"),
            )?)?;
            w.append(&PredefinedMenuItem::separator(app)?)?;
            w.append(&PredefinedMenuItem::close_window(
                app,
                Some("ウインドウを閉じる"),
            )?)?;
            menu.append(&s)?;
            menu.append(&w)?;
            continue;
        }
        menu.append(&s)?;
    }
    Ok(menu)
}

/// 画面から、メニューの中身を受け取って Mac のメニューバーに出す（macOS 以外では何もしない）
#[tauri::command]
pub fn menu_set(app: AppHandle, menus: Vec<MenuSpec>) -> Result<bool, String> {
    if !cfg!(target_os = "macos") {
        return Ok(false);
    }
    let menu = build(&app, &menus).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(true)
}

/// メニューの項目が選ばれたとき：画面に、元の動作の id を知らせる
pub fn on_event(app: &AppHandle, id: &str) {
    let action = id.split_once('|').map(|(_, a)| a).unwrap_or(id);
    let _ = app.emit("menu-action", action);
}
