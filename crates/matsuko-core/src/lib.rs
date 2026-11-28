//! Matsuko Editor の中心部分。
//!
//! 画面（WebView）や Tauri に依存しない処理をここに置き、単体テストしやすくする。
//! プロジェクトの型、タイムラインの計算（M0）、素材の解析・波形・パスの扱い（M1）、書き出し（M3）を持つ。
//! 型はブラウザ版（`src/matsuko-editor.html` の `P`）が保存する JSON と同じ形にしてある。

pub mod export;
pub mod keyframes;
pub mod model;
pub mod paths;
pub mod peaks;
pub mod probe;
pub mod run;
pub mod timeline;

pub use model::Project;
