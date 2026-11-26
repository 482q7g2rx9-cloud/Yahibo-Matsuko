//! Linux 用：素材を画面へ渡す小さな HTTP サーバー（127.0.0.1 だけで待ち受ける）。
//!
//! Linux の WebKitGTK は、asset: のような独自のスキームの動画・音声を再生できない（fetch では読めるが、
//! video 要素は「対応していない形式」になる）。そのため Linux では、このサーバーの URL を使う。
//! URL には起動ごとに作る合言葉（token）を入れ、使ってよいファイル（AppState::served）だけを返す。
//! 動画のシークのため Range（部分の読み出し）に対応する。

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::state::state;

/// 画面が使う URL の頭（例：http://127.0.0.1:41234/2f9c…/）
static BASE: OnceLock<String> = OnceLock::new();

pub fn base() -> Option<String> {
    BASE.get().cloned()
}

fn token() -> String {
    let mut s = String::new();
    for _ in 0..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        h.write_u32(std::process::id());
        s.push_str(&format!("{:016x}", h.finish()));
    }
    s
}

/// サーバーを起動する（起動できなければ何もしない。画面は asset: に戻る）
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)).await else {
            return;
        };
        let Ok(addr) = listener.local_addr() else {
            return;
        };
        let tok = token();
        let _ = BASE.set(format!("http://127.0.0.1:{}/{}/", addr.port(), tok));
        loop {
            let Ok((sock, _)) = listener.accept().await else {
                continue;
            };
            let (app, tok) = (app.clone(), tok.clone());
            tauri::async_runtime::spawn(async move {
                let _ = serve(app, sock, &tok).await;
            });
        }
    });
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return None;
            }
            let h = std::str::from_utf8(&b[i + 1..i + 3]).ok()?;
            out.push(u8::from_str_radix(h, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn mime(p: &std::path::Path) -> &'static str {
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("m4a") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg" | "opus") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("aac") => "audio/aac",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

/// 「bytes=a-b」「bytes=a-」「bytes=-n」を、ファイルの大きさ `len` の中の範囲 [a, b] にする
pub fn parse_range(v: &str, len: u64) -> Option<(u64, u64)> {
    let r = v.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = r.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (a, b) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len - 1)
    } else {
        let a: u64 = a.parse().ok()?;
        let b: u64 = if b.is_empty() {
            len - 1
        } else {
            b.parse::<u64>().ok()?.min(len - 1)
        };
        (a, b)
    };
    if a > b || a >= len {
        return None;
    }
    Some((a, b))
}

async fn reply(sock: &mut TcpStream, status: &str, extra: &str) -> std::io::Result<()> {
    let head = format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n{extra}\r\n");
    sock.write_all(head.as_bytes()).await
}

async fn serve(app: AppHandle, mut sock: TcpStream, tok: &str) -> std::io::Result<()> {
    let mut reader = BufReader::new(&mut sock);
    let mut line = String::new();
    reader.read_line(&mut line).await?;
    let mut range = None;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).await? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range = Some(v.trim().to_string());
            }
        }
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method == "OPTIONS" {
        return reply(
            &mut sock,
            "204 No Content",
            "Access-Control-Allow-Headers: Range\r\n",
        )
        .await;
    }
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        return reply(&mut sock, "405 Method Not Allowed", "").await;
    }
    let Some(rest) = target
        .strip_prefix('/')
        .and_then(|t| t.strip_prefix(tok))
        .and_then(|t| t.strip_prefix('/'))
    else {
        return reply(&mut sock, "404 Not Found", "").await;
    };
    let rest = rest.split('?').next().unwrap_or("");
    let Some(path) = percent_decode(rest).map(PathBuf::from) else {
        return reply(&mut sock, "400 Bad Request", "").await;
    };
    if !state(&app).served(&path) {
        return reply(&mut sock, "403 Forbidden", "").await;
    }
    let Ok(mut f) = tokio::fs::File::open(&path).await else {
        return reply(&mut sock, "404 Not Found", "").await;
    };
    let len = f.metadata().await?.len();
    let (status, a, b) = match range.as_deref() {
        Some(r) => match parse_range(r, len) {
            Some((a, b)) => ("206 Partial Content", a, b),
            None => {
                return reply(
                    &mut sock,
                    "416 Range Not Satisfiable",
                    &format!("Content-Range: bytes */{len}\r\n"),
                )
                .await
            }
        },
        None => ("200 OK", 0, len.saturating_sub(1)),
    };
    let n = if len == 0 { 0 } else { b - a + 1 };
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {n}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Range\r\nCache-Control: no-store\r\nConnection: close\r\n",
        mime(&path)
    );
    if status.starts_with("206") {
        head.push_str(&format!("Content-Range: bytes {a}-{b}/{len}\r\n"));
    }
    head.push_str("\r\n");
    sock.write_all(head.as_bytes()).await?;
    if head_only || n == 0 {
        return Ok(());
    }
    f.seek(std::io::SeekFrom::Start(a)).await?;
    let mut left = n;
    let mut buf = vec![0u8; 256 * 1024];
    while left > 0 {
        let want = buf.len().min(left as usize);
        let got = f.read(&mut buf[..want]).await?;
        if got == 0 {
            break;
        }
        // 再生をやめると画面側が接続を切るので、書けなくなったら終わる
        sock.write_all(&buf[..got]).await?;
        left -= got as u64;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=0-5000", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn decode() {
        assert_eq!(
            percent_decode("%2Fhome%2F%E7%B4%A0%E6%9D%90.mp4").unwrap(),
            "/home/素材.mp4"
        );
        assert!(percent_decode("%zz").is_none());
    }
}
