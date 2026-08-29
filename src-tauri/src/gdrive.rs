use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const BACKUP_FOLDER_NAME: &str = "Godown Stock Register Backups";

fn client_id() -> Option<&'static str> {
    option_env!("GOOGLE_OAUTH_CLIENT_ID").filter(|s| !s.is_empty())
}
fn client_secret() -> Option<&'static str> {
    option_env!("GOOGLE_OAUTH_CLIENT_SECRET").filter(|s| !s.is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GoogleTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub email: Option<String>,
}

pub struct GoogleState {
    pub tokens: Mutex<Option<GoogleTokens>>,
    pub tokens_path: PathBuf,
}

impl GoogleState {
    pub fn load(tokens_path: PathBuf) -> Self {
        let tokens = std::fs::read_to_string(&tokens_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
        GoogleState {
            tokens: Mutex::new(tokens),
            tokens_path,
        }
    }

    fn persist(&self, tokens: &Option<GoogleTokens>) -> std::io::Result<()> {
        match tokens {
            Some(t) => std::fs::write(&self.tokens_path, serde_json::to_string_pretty(t)?),
            None => {
                if self.tokens_path.exists() {
                    std::fs::remove_file(&self.tokens_path)?;
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    pub configured: bool,
    pub connected: bool,
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveBackupEntry {
    pub id: String,
    pub name: String,
    pub created_time: String,
    pub size: Option<i64>,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn random_url_safe(len: usize) -> String {
    let bytes: Vec<u8> = (0..len).map(|_| rand::thread_rng().gen()).collect();
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

/// Waits for exactly one HTTP GET on the loopback listener and returns its query string.
fn await_redirect(listener: TcpListener) -> Result<String, String> {
    let (stream, _) = listener.accept().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;
    // Example: "GET /callback?code=...&state=... HTTP/1.1"
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or("Malformed redirect request")?
        .to_string();
    let query = path
        .split_once('?')
        .map(|(_, q)| q)
        .unwrap_or("")
        .to_string();

    let mut stream = stream;
    let body = "<html><body style=\"font-family:sans-serif;padding:40px;text-align:center\">\
        <h2>Godown Stock Register</h2><p>You're connected. You can close this tab and go back to the app.</p>\
        </body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    Ok(query)
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let mut it = pair.splitn(2, '=');
            let k = it.next()?;
            let v = it.next().unwrap_or("");
            Some((urlencoding_decode(k), urlencoding_decode(v)))
        })
        .collect()
}

fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: i64,
}

pub fn status(state: &GoogleState) -> GoogleStatus {
    let tokens = state.tokens.lock().unwrap();
    GoogleStatus {
        configured: client_id().is_some() && client_secret().is_some(),
        connected: tokens.is_some(),
        email: tokens.as_ref().and_then(|t| t.email.clone()),
    }
}

pub async fn connect(state: &GoogleState, app: &tauri::AppHandle) -> Result<GoogleStatus, String> {
    let client_id = client_id().ok_or("Google Drive isn't configured in this build.")?;
    let client_secret = client_secret().ok_or("Google Drive isn't configured in this build.")?;

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let verifier = random_url_safe(64);
    let challenge = pkce_challenge(&verifier);
    let csrf_state = random_url_safe(16);

    let auth_url = format!(
        "{AUTH_URL}?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope={scope}&code_challenge={challenge}&code_challenge_method=S256&state={csrf_state}&access_type=offline&prompt=consent",
        redirect = urlencoding_encode(&redirect_uri),
        scope = urlencoding_encode(SCOPE),
    );

    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(auth_url, None::<String>)
        .map_err(|e| format!("Couldn't open the browser: {e}"))?;

    let query = tauri::async_runtime::spawn_blocking(move || await_redirect(listener))
        .await
        .map_err(|e| e.to_string())??;
    let params = parse_query(&query);

    if params.get("state").map(|s| s.as_str()) != Some(csrf_state.as_str()) {
        return Err("Sign-in didn't complete (state mismatch). Please try again.".into());
    }
    let code = params
        .get("code")
        .ok_or("Sign-in didn't complete — no code returned. Please try again.")?;

    let http = reqwest::Client::new();
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("code_verifier", &verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Google rejected the sign-in: {body}"));
    }
    let tok: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;
    let refresh_token = tok
        .refresh_token
        .ok_or("Google didn't return a refresh token. Try disconnecting any prior access at myaccount.google.com/permissions and reconnecting.")?;

    let email = fetch_email(&http, &tok.access_token).await;

    let tokens = GoogleTokens {
        access_token: tok.access_token,
        refresh_token,
        expires_at: now_unix() + tok.expires_in,
        email,
    };
    {
        let mut guard = state.tokens.lock().unwrap();
        *guard = Some(tokens);
        state.persist(&guard).map_err(|e| e.to_string())?;
    }
    Ok(status(state))
}

async fn fetch_email(http: &reqwest::Client, access_token: &str) -> Option<String> {
    let resp = http
        .get("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)")
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    json.get("user")?
        .get("emailAddress")?
        .as_str()
        .map(|s| s.to_string())
}

pub fn disconnect(state: &GoogleState) -> Result<(), String> {
    let mut guard = state.tokens.lock().unwrap();
    *guard = None;
    state.persist(&guard).map_err(|e| e.to_string())
}

/// Returns a fresh access token, refreshing it first if it's expired or close to it.
async fn fresh_access_token(state: &GoogleState) -> Result<String, String> {
    let client_id = client_id().ok_or("Google Drive isn't configured in this build.")?;
    let client_secret = client_secret().ok_or("Google Drive isn't configured in this build.")?;

    let needs_refresh = {
        let guard = state.tokens.lock().unwrap();
        let t = guard.as_ref().ok_or("Not connected to Google Drive.")?;
        now_unix() >= t.expires_at - 60
    };

    if needs_refresh {
        let refresh_token = {
            let guard = state.tokens.lock().unwrap();
            guard.as_ref().unwrap().refresh_token.clone()
        };
        let http = reqwest::Client::new();
        let resp = http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("refresh_token", refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Couldn't refresh the Google Drive connection — you may need to reconnect. ({body})"
            ));
        }
        let tok: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;
        let mut guard = state.tokens.lock().unwrap();
        if let Some(t) = guard.as_mut() {
            t.access_token = tok.access_token;
            t.expires_at = now_unix() + tok.expires_in;
        }
        state.persist(&guard).map_err(|e| e.to_string())?;
    }

    let guard = state.tokens.lock().unwrap();
    Ok(guard.as_ref().unwrap().access_token.clone())
}

async fn ensure_backup_folder(
    http: &reqwest::Client,
    access_token: &str,
) -> Result<String, String> {
    let query = format!(
        "name = '{BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    );
    let resp = http
        .get("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(access_token)
        .query(&[
            ("q", query.as_str()),
            ("spaces", "drive"),
            ("fields", "files(id,name)"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if let Some(id) = json["files"][0]["id"].as_str() {
        return Ok(id.to_string());
    }

    let resp = http
        .post("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "name": BACKUP_FOLDER_NAME,
            "mimeType": "application/vnd.google-apps.folder",
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    json["id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or("Couldn't create the backups folder in Google Drive.".to_string())
}

pub async fn upload_backup(
    state: &GoogleState,
    file_bytes: Vec<u8>,
    filename: &str,
) -> Result<(), String> {
    let access_token = fresh_access_token(state).await?;
    let http = reqwest::Client::new();
    let folder_id = ensure_backup_folder(&http, &access_token).await?;

    let metadata = serde_json::json!({ "name": filename, "parents": [folder_id] });
    let metadata_part = reqwest::multipart::Part::text(metadata.to_string())
        .mime_str("application/json; charset=UTF-8")
        .map_err(|e| e.to_string())?;
    let media_part = reqwest::multipart::Part::bytes(file_bytes)
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("metadata", metadata_part)
        .part("file", media_part);

    let resp = http
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Google Drive upload failed: {body}"));
    }
    Ok(())
}

pub async fn list_backups(state: &GoogleState) -> Result<Vec<DriveBackupEntry>, String> {
    let access_token = fresh_access_token(state).await?;
    let http = reqwest::Client::new();
    let folder_id = ensure_backup_folder(&http, &access_token).await?;

    let query = format!("'{folder_id}' in parents and trashed = false");
    let resp = http
        .get("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(access_token)
        .query(&[
            ("q", query.as_str()),
            ("orderBy", "createdTime desc"),
            ("fields", "files(id,name,createdTime,size)"),
            ("pageSize", "50"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let files = json["files"].as_array().cloned().unwrap_or_default();
    Ok(files
        .into_iter()
        .filter_map(|f| {
            Some(DriveBackupEntry {
                id: f["id"].as_str()?.to_string(),
                name: f["name"].as_str()?.to_string(),
                created_time: f["createdTime"].as_str().unwrap_or("").to_string(),
                size: f["size"].as_str().and_then(|s| s.parse().ok()),
            })
        })
        .collect())
}

pub async fn download_backup(state: &GoogleState, file_id: &str) -> Result<Vec<u8>, String> {
    let access_token = fresh_access_token(state).await?;
    let http = reqwest::Client::new();
    let resp = http
        .get(format!(
            "https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Couldn't download that backup: {body}"));
    }
    Ok(resp.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

#[allow(dead_code)]
pub async fn revoke(state: &GoogleState) {
    let token = {
        let guard = state.tokens.lock().unwrap();
        guard.as_ref().map(|t| t.refresh_token.clone())
    };
    if let Some(token) = token {
        let http = reqwest::Client::new();
        let _ = http
            .post(REVOKE_URL)
            .form(&[("token", token.as_str())])
            .send()
            .await;
    }
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
