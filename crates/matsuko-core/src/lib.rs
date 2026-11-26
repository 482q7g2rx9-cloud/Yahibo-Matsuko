//! Matsuko Editor の中心部分。
//!
//! 画面（WebView）や Tauri に依存しない処理をここに置き、単体テストしやすくする。
//! M0 ではプロジェクトの型と、タイムラインの基本的な計算だけを持つ。
//! 型はブラウザ版（`src/matsuko-editor.html` の `P`）が保存する JSON と同じ形にしてある。

pub mod model;
pub mod timeline;

pub use model::Project;
