//! Phone link: a small HTTP server on the local network. The phone opens the page it
//! serves (scanned from a QR code), takes photos and uploads them into the inbox.
//! Every API call must carry the pairing key; nothing is reachable from the internet.

use crate::inbox::{self, NewItem, MAX_IMAGE_BYTES};
use serde::Serialize;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Request, Response, Server};

const PAGE: &str = include_str!("../phone/index.html");
const ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");
/// The Android app (built by `npm run build:apk`), offered for download on the phone page.
const APK: &[u8] = include_bytes!("../phone/maree-phone.apk");
/// UDP port on which the Android app looks for this computer.
pub const DISCOVERY_PORT: u16 = 47148;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    pub port: u16,
    /// Candidate addresses for the phone, most likely first.
    pub urls: Vec<String>,
}

struct Running {
    server: Arc<Server>,
    alive: Arc<AtomicBool>,
    token: String,
    status: LinkStatus,
}

#[derive(Default)]
pub struct PhoneLink {
    running: Mutex<Option<Running>>,
    /// JSON served to the phone at /api/info (recent problems, language); set by the UI.
    context: Arc<Mutex<String>>,
}

fn is_private(ip: &Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 10 || (o[0] == 172 && (16..=31).contains(&o[1])) || (o[0] == 192 && o[1] == 168) || (o[0] == 100 && (64..=127).contains(&o[1]))
}

/// LAN IPv4 addresses, with the one used for the default route first.
fn lan_addresses() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    // Connecting a UDP socket sends nothing; it only asks the OS which interface it would use.
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("192.0.2.1:9").is_ok() {
            if let Ok(IpAddr::V4(ip)) = sock.local_addr().map(|a| a.ip()) {
                if is_private(&ip) {
                    out.push(ip);
                }
            }
        }
    }
    if let Ok(ifs) = if_addrs::get_if_addrs() {
        let mut rest: Vec<(i32, Ipv4Addr)> = ifs
            .into_iter()
            .filter_map(|i| match i.ip() {
                IpAddr::V4(ip) if !ip.is_loopback() && is_private(&ip) => {
                    let name = i.name.to_lowercase();
                    let virtual_if = ["vethernet", "vmware", "virtualbox", "hyper-v", "wsl", "docker", "loopback"].iter().any(|v| name.contains(v));
                    let rank = if virtual_if { 3 } else if ip.octets()[0] == 192 { 0 } else if ip.octets()[0] == 10 { 1 } else { 2 };
                    Some((rank, ip))
                }
                _ => None,
            })
            .collect();
        rest.sort();
        for (_, ip) in rest {
            if !out.contains(&ip) {
                out.push(ip);
            }
        }
    }
    out
}

fn header(req: &Request, name: &str) -> String {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| crate::percent_decode(h.value.as_str()))
        .unwrap_or_default()
}

fn content_type(v: &str) -> Header {
    Header::from_bytes(&b"Content-Type"[..], v.as_bytes()).expect("valid header")
}

fn security_headers<R: Read>(mut resp: Response<R>) -> Response<R> {
    for (k, v) in [
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
        (
            "Content-Security-Policy",
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; manifest-src 'self'",
        ),
    ] {
        resp.add_header(Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("valid header"));
    }
    resp
}

fn json(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    security_headers(Response::from_string(body).with_status_code(status).with_header(content_type("application/json; charset=utf-8")))
}

fn error(status: u16, msg: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    json(status, serde_json::json!({ "ok": false, "error": msg }).to_string())
}

fn constant_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn handle(mut req: Request, token: &str, inbox_dir: &PathBuf, context: &Arc<Mutex<String>>, app: &AppHandle) {
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("/").to_string();
    let method = req.method().clone();
    let authed = constant_eq(&header(&req, "x-maree-key"), token);
    let resp = match (method, path.as_str()) {
        (Method::Get, "/") | (Method::Get, "/index.html") => {
            security_headers(Response::from_string(PAGE).with_header(content_type("text/html; charset=utf-8")))
        }
        (Method::Get, "/manifest.webmanifest") => {
            let m = serde_json::json!({
                "name": "Marée",
                "short_name": "Marée",
                "start_url": "/",
                "display": "standalone",
                "background_color": "#FAF8F6",
                "theme_color": "#FAF8F6",
                "icons": [{ "src": "/icon.png", "sizes": "256x256", "type": "image/png" }]
            });
            security_headers(Response::from_string(m.to_string()).with_header(content_type("application/manifest+json")))
        }
        (Method::Get, "/maree.apk") => security_headers(
            Response::from_data(APK.to_vec())
                .with_header(content_type("application/vnd.android.package-archive"))
                .with_header(Header::from_bytes(&b"Content-Disposition"[..], &b"attachment; filename=\"maree-phone.apk\""[..]).expect("valid header")),
        ),
        (Method::Get, "/icon.png") | (Method::Get, "/apple-touch-icon.png") => {
            security_headers(Response::from_data(ICON.to_vec()).with_header(content_type("image/png")))
        }
        (Method::Get, "/api/info") if authed => json(200, context.lock().map(|c| c.clone()).unwrap_or_else(|_| "{}".into())),
        (Method::Post, "/api/upload") if authed => {
            let declared = req.body_length().unwrap_or(0);
            if declared > MAX_IMAGE_BYTES {
                error(413, "too large")
            } else {
                let mut bytes = Vec::with_capacity(declared);
                let read = req.as_reader().take(MAX_IMAGE_BYTES as u64 + 1).read_to_end(&mut bytes);
                if read.is_err() {
                    error(400, "upload interrupted")
                } else if bytes.len() > MAX_IMAGE_BYTES {
                    error(413, "too large")
                } else {
                    let problem = header(&req, "x-problem");
                    let item = NewItem {
                        bytes: &bytes,
                        kind: &header(&req, "x-kind"),
                        problem_id: if problem.is_empty() { None } else { Some(problem) },
                        note: &header(&req, "x-note"),
                        origin: "phone",
                        original_name: &header(&req, "x-name"),
                    };
                    match inbox::add(inbox_dir, item) {
                        Ok(it) => {
                            let _ = app.emit("inbox-changed", &it.id);
                            json(200, serde_json::json!({ "ok": true, "id": it.id }).to_string())
                        }
                        Err(e) => error(415, &e),
                    }
                }
            }
        }
        (_, p) if p.starts_with("/api/") => error(401, "not paired"),
        _ => error(404, "not found"),
    };
    let _ = req.respond(resp);
}

impl PhoneLink {
    pub fn status(&self) -> Option<LinkStatus> {
        self.running.lock().ok()?.as_ref().map(|r| r.status.clone())
    }

    pub fn set_context(&self, json: String) {
        if let Ok(mut c) = self.context.lock() {
            *c = json;
        }
    }

    pub fn start(&self, app: AppHandle, inbox_dir: PathBuf, token: String, port: u16) -> Result<LinkStatus, String> {
        if token.len() < 16 {
            return Err("pairing key too short".into());
        }
        let mut guard = self.running.lock().map_err(|e| e.to_string())?;
        if let Some(r) = guard.as_ref() {
            if r.token == token && r.status.port == port {
                let mut status = r.status.clone();
                status.urls = urls(port, &token);
                return Ok(status);
            }
        }
        if let Some(r) = guard.take() {
            r.server.unblock();
            r.alive.store(false, Ordering::SeqCst);
        }
        // Automated tests stay on the loopback interface (no firewall prompt, nothing exposed).
        let host = if loopback_only() { "127.0.0.1" } else { "0.0.0.0" };
        let server = Arc::new(Server::http((host, port)).map_err(|e| format!("Port {port} is not available: {e}"))?);
        let status = LinkStatus { port, urls: urls(port, &token) };
        let (srv, tok, ctx) = (server.clone(), token.clone(), self.context.clone());
        std::thread::spawn(move || {
            for req in srv.incoming_requests() {
                let (tok, dir, ctx, app) = (tok.clone(), inbox_dir.clone(), ctx.clone(), app.clone());
                // One thread per request keeps the page responsive during a slow upload.
                std::thread::spawn(move || handle(req, &tok, &dir, &ctx, &app));
            }
        });
        let alive = Arc::new(AtomicBool::new(true));
        spawn_discovery(host, discovery_tag(&token), port, alive.clone());
        *guard = Some(Running { server, alive, token, status: status.clone() });
        Ok(status)
    }

    pub fn stop(&self) {
        if let Ok(mut g) = self.running.lock() {
            if let Some(r) = g.take() {
                r.server.unblock();
                r.alive.store(false, Ordering::SeqCst);
            }
        }
    }
}

/// What the app sends to find its computer: a hash of the pairing key, never the key.
pub fn discovery_tag(token: &str) -> String {
    crate::files::sha256_hex(token.as_bytes())[..12].to_string()
}

/// Answers "MAREE-DISCOVER <tag>" broadcasts from a paired phone with "MAREE <port>".
fn spawn_discovery(host: &str, tag: String, port: u16, alive: Arc<AtomicBool>) {
    let sock = match UdpSocket::bind((host, DISCOVERY_PORT)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("phone discovery unavailable: {e}");
            return;
        }
    };
    let _ = sock.set_read_timeout(Some(Duration::from_millis(500)));
    std::thread::spawn(move || {
        let mut buf = [0u8; 128];
        while alive.load(Ordering::SeqCst) {
            if let Ok((n, from)) = sock.recv_from(&mut buf) {
                if discovery_reply(&buf[..n], &tag) {
                    let _ = sock.send_to(format!("MAREE {port}").as_bytes(), from);
                }
            }
        }
    });
}

fn discovery_reply(msg: &[u8], tag: &str) -> bool {
    std::str::from_utf8(msg).map(|m| m.trim() == format!("MAREE-DISCOVER {tag}")).unwrap_or(false)
}

fn loopback_only() -> bool {
    std::env::var("MAREE_E2E").map(|v| v == "1").unwrap_or(false)
}

fn urls(port: u16, token: &str) -> Vec<String> {
    if loopback_only() {
        return vec![format!("http://127.0.0.1:{port}/?k={token}")];
    }
    lan_addresses().into_iter().map(|ip| format!("http://{ip}:{port}/?k={token}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_ranges() {
        assert!(is_private(&Ipv4Addr::new(192, 168, 1, 20)));
        assert!(is_private(&Ipv4Addr::new(10, 0, 0, 5)));
        assert!(is_private(&Ipv4Addr::new(172, 20, 1, 1)));
        assert!(!is_private(&Ipv4Addr::new(8, 8, 8, 8)));
        assert!(!is_private(&Ipv4Addr::new(172, 32, 0, 1)));
    }

    #[test]
    fn discovery_only_answers_the_paired_phone() {
        let tag = discovery_tag("abcdef0123456789abcdef");
        assert_eq!(tag.len(), 12);
        assert!(discovery_reply(format!("MAREE-DISCOVER {tag}\n").as_bytes(), &tag));
        assert!(!discovery_reply(b"MAREE-DISCOVER 000000000000", &tag));
        assert!(!discovery_reply(b"hello", &tag));
    }

    #[test]
    fn key_comparison() {
        assert!(constant_eq("abcdef0123456789", "abcdef0123456789"));
        assert!(!constant_eq("abcdef0123456789", "abcdef0123456788"));
        assert!(!constant_eq("abc", "abcd"));
    }
}
