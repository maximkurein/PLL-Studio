//! Quick CLI probe of the models: `cargo run -p pll-core --example probe -- 1000e6`
use pll_core::Engine;
use serde_json::json;

fn main() {
    let hz: f64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(2.05e9);
    let mut e = Engine::new(None);
    let t = e.handle("tune", json!({ "hz": hz })).unwrap();
    let d = &t["derived"];
    println!("target {:.6} MHz → fOUT {:.6} MHz, fVCO {:.3} MHz, fPFD {:.3} MHz, INT {} FRAC {} MOD {} M0 {}",
        hz / 1e6, d["f_out_a"].as_f64().unwrap() / 1e6, d["f_vco"].as_f64().unwrap() / 1e6,
        d["f_pfd"].as_f64().unwrap() / 1e6, d["int"], d["frac"], d["modulus"], d["m0"]);
    let l = e.handle("loop_analysis", json!({})).unwrap();
    println!("loop: fc {:.1} kHz, PM {:.1}°, settle {:?} s, LD {:?} s, slips {}",
        l["analysis"]["fc_hz"].as_f64().unwrap() / 1e3, l["analysis"]["pm_deg"].as_f64().unwrap(),
        l["transient"]["settle_s"], l["transient"]["ld_s"], l["transient"]["cycle_slips"]);
    let n = e.handle("phase_noise", json!({})).unwrap();
    println!("jitter {:.1} fs (12k–20M), marks {:?}", n["jitter_fs"].as_f64().unwrap(), n["marks"]);
    for s in n["spurs"].as_array().unwrap() {
        println!("  spur {:>12.1} Hz {:>7.1} dBc  {}", s["offset_hz"].as_f64().unwrap(), s["level_dbc"].as_f64().unwrap(), s["label"]);
    }
    let p = e.handle("power", json!({})).unwrap();
    println!("power {:.0} mW, {:.1} mA, Tj {:.1} °C", p["power_mw"].as_f64().unwrap(), p["total_ma"].as_f64().unwrap(), p["tj_c"].as_f64().unwrap());
    std::thread::sleep(std::time::Duration::from_millis(5));
    let s = e.handle("status", json!({})).unwrap();
    println!("sim: {} vtune {:.3} V, lock_time {:?} us", s["sim"]["state"], s["sim"]["vtune"].as_f64().unwrap(), s["sim"]["lock_time_us"]);
}
