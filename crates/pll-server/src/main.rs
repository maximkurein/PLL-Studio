//! PLL Studio headless server ("remote lab").
//!
//! Serves the built web UI (`dist/`) and the same JSON RPC the desktop app
//! uses. Run it on the computer the board is attached to and open the UI from
//! any browser on the network:
//!
//!   cargo run --release -p pll-server -- --host 0.0.0.0 --port 7878 --dist dist

use axum::{extract::State, routing::post, Json, Router};
use pll_core::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower_http::{cors::CorsLayer, services::ServeDir};

#[derive(Deserialize)]
struct Req {
    cmd: String,
    #[serde(default)]
    args: Value,
}

type Shared = Arc<Mutex<Engine>>;

async fn rpc(State(engine): State<Shared>, Json(req): Json<Req>) -> Json<Value> {
    let res = tokio::task::spawn_blocking(move || {
        let mut e = engine.lock().map_err(|_| "engine poisoned".to_string())?;
        e.handle(&req.cmd, req.args).map_err(|e| e.to_string())
    })
    .await;
    Json(match res {
        Ok(Ok(v)) => json!({ "ok": true, "data": v }),
        Ok(Err(e)) => json!({ "ok": false, "error": e }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    })
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("pll-server [--host 127.0.0.1] [--port 7878] [--dist dist] [--config path.json]");
        return;
    }
    let host = flag(&args, "--host").unwrap_or_else(|| "127.0.0.1".into());
    let port = flag(&args, "--port").unwrap_or_else(|| "7878".into());
    let dist = PathBuf::from(flag(&args, "--dist").unwrap_or_else(|| "dist".into()));
    let config = flag(&args, "--config").map(PathBuf::from).or_else(|| {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(|h| PathBuf::from(h).join(".pll-studio").join("server.json"))
    });

    let engine: Shared = Arc::new(Mutex::new(Engine::new(config)));
    let app = Router::new()
        .route("/api/rpc", post(rpc))
        .fallback_service(ServeDir::new(&dist))
        .layer(CorsLayer::permissive())
        .with_state(engine);

    let addr = format!("{}:{}", host, port);
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    println!("PLL Studio server: http://{}  (UI из {:?})", addr, dist);
    axum::serve(listener, app).await.expect("server");
}
