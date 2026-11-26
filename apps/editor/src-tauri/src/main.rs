// リリース版の Windows で、余計なコンソール画面を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    matsuko_editor_lib::run()
}
