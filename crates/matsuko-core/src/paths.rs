//! プロジェクトフォルダーと素材のパス。
//! 素材はフルパスと、プロジェクトフォルダーからの相対パスの両方を保存しておき、
//! フォルダーごと別のパソコンへ移しても見つけられるようにする。

use std::path::{Component, Path, PathBuf};

/// `base` から `target` への相対パス（`/` 区切り）。ドライブが違うなど作れなければ None
pub fn relative(base: &Path, target: &Path) -> Option<String> {
    let b: Vec<Component> = base.components().collect();
    let t: Vec<Component> = target.components().collect();
    // ドライブ（Windows）やルートが違うなら相対にしない
    match (b.first(), t.first()) {
        (Some(x), Some(y)) if x == y => {}
        _ => return None,
    }
    let common = b.iter().zip(&t).take_while(|(x, y)| x == y).count();
    let mut parts: Vec<String> = Vec::new();
    for c in &b[common..] {
        if matches!(c, Component::Normal(_)) {
            parts.push("..".into());
        }
    }
    for c in &t[common..] {
        parts.push(c.as_os_str().to_string_lossy().into_owned());
    }
    if parts.is_empty() {
        return Some(".".into());
    }
    Some(parts.join("/"))
}

/// 素材を探す候補の順番：保存したフルパス → プロジェクトからの相対パス → プロジェクトフォルダー直下と media/ の同じ名前
pub fn candidates(
    project_dir: &Path,
    abs: Option<&str>,
    rel: Option<&str>,
    file_name: &str,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(a) = abs.filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(a));
    }
    if let Some(r) = rel.filter(|s| !s.is_empty()) {
        out.push(normalize(&project_dir.join(r)));
    }
    if !file_name.is_empty() {
        out.push(project_dir.join(file_name));
        out.push(project_dir.join("media").join(file_name));
    }
    out
}

/// `..` や `.` を取り除く（ファイルがなくても使える）
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 見つかった最初の候補
pub fn resolve(
    project_dir: &Path,
    abs: Option<&str>,
    rel: Option<&str>,
    file_name: &str,
) -> Option<PathBuf> {
    candidates(project_dir, abs, rel, file_name)
        .into_iter()
        .find(|p| p.is_file())
}

/// ファイル名に使えない文字を置き換える（プロジェクト名からフォルダー名を作る）
pub fn safe_name(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let s = s.trim_matches(|c| c == '.' || c == ' ').to_string();
    if s.is_empty() {
        "無題のプロジェクト".into()
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_paths() {
        let base = Path::new("/home/a/proj");
        assert_eq!(
            relative(base, Path::new("/home/a/proj/media/x.mp4")).unwrap(),
            "media/x.mp4"
        );
        assert_eq!(
            relative(base, Path::new("/home/a/clips/x.mp4")).unwrap(),
            "../clips/x.mp4"
        );
        assert_eq!(relative(base, Path::new("/home/a/proj")).unwrap(), ".");
    }

    #[test]
    fn normalize_dots() {
        assert_eq!(
            normalize(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
    }

    #[test]
    fn resolve_moved_project() {
        let tmp = std::env::temp_dir().join(format!("matsuko-paths-{}", std::process::id()));
        let proj = tmp.join("moved/proj");
        std::fs::create_dir_all(proj.join("media")).unwrap();
        std::fs::write(proj.join("media/a.mp4"), b"x").unwrap();
        std::fs::create_dir_all(tmp.join("moved/clips")).unwrap();
        std::fs::write(tmp.join("moved/clips/b.mp4"), b"x").unwrap();
        // フルパスは古い場所。相対パスで見つかる
        let got = resolve(
            &proj,
            Some("/old/place/b.mp4"),
            Some("../clips/b.mp4"),
            "b.mp4",
        )
        .unwrap();
        assert_eq!(got, tmp.join("moved/clips/b.mp4"));
        // 相対パスもなければ、media/ の同じ名前
        let got = resolve(&proj, Some("/old/a.mp4"), None, "a.mp4").unwrap();
        assert_eq!(got, proj.join("media/a.mp4"));
        assert!(resolve(&proj, None, None, "none.mp4").is_none());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn safe_names() {
        assert_eq!(safe_name(" 商店街:特集? "), "商店街_特集_");
        assert_eq!(safe_name("..."), "無題のプロジェクト");
    }
}
