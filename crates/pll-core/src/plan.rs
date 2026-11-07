//! Frequency chain derivation and frequency planner.
//!
//! fPFD = REF_IN · (1 + D) / (R · (1 + T))            (datasheet eq. 3)
//! fVCO = fPFD · (INT + FRAC / MOD)                     (eq. 2, fundamental feedback)
//! fOUT = fVCO / M0

use crate::regs::{self, Words};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const VCO_MIN: f64 = 2200e6;
pub const VCO_MAX: f64 = 4400e6;
pub const OUT_MIN: f64 = 34.375e6;
pub const OUT_MAX: f64 = 4400e6;
pub const PFD_MAX_FRAC: f64 = 125e6;
pub const PFD_MAX_INT: f64 = 310e6;
pub const REF_MIN: f64 = 5e6;
pub const REF_MAX: f64 = 310e6;
pub const REF_MAX_DOUBLER: f64 = 100e6;
pub const INT_MIN: u32 = 8;
pub const KVCO_TYP: f64 = 40e6;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Error,
    Warn,
    Info,
}

#[derive(Serialize, Clone, Debug)]
pub struct Issue {
    pub level: Level,
    pub block: &'static str,
    pub msg: String,
}

fn issue(v: &mut Vec<Issue>, level: Level, block: &'static str, msg: impl Into<String>) {
    v.push(Issue { level, block, msg: msg.into() });
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Derived {
    pub f_ref: f64,
    pub f_doubled: f64,
    pub f_r: f64,
    pub f_pfd: f64,
    pub t_pfd_ns: f64,
    pub r: u32,
    pub doubler: bool,
    pub div2: bool,
    pub int: u32,
    pub frac: u32,
    pub modulus: u32,
    pub phase: u32,
    pub hi_res: bool,
    pub n: f64,
    pub integer_mode: bool,
    pub sdm_order: u32,
    pub f_vco: f64,
    pub vco_core: u8,
    pub m0: u32,
    pub fb_fundamental: bool,
    /// Division ratio between VCO and PFD (what the loop "sees").
    pub n_loop: f64,
    pub f_div_out: f64,
    pub f_out_a: f64,
    pub f_out_b: f64,
    pub out_a_en: bool,
    pub out_b_en: bool,
    pub pwr_a_dbm: f64,
    pub pwr_b_dbm: f64,
    pub band_sel_div: u32,
    pub f_band_sel: f64,
    pub channel_step_hz: f64,
    pub phase_deg: f64,
    pub phase_step_deg: f64,
    pub icp_ma: f64,
    pub ld_window_ns: f64,
    pub ld_cycles: u32,
    pub t_sync_s: f64,
    pub frac_spur_step_hz: f64,
    pub ibs_offset_hz: Option<f64>,
    pub inband_floor_dbc: f64,
    pub issues: Vec<Issue>,
}

pub fn vco_core(f_vco: f64) -> u8 {
    if f_vco < 2930e6 {
        0
    } else if f_vco < 3660e6 {
        1
    } else {
        2
    }
}

/// Repeat length L of the ΣΔ sequence with dither off (Table 4B).
pub fn frac_repeat_len(modulus: u32) -> u64 {
    let m = modulus as u64;
    match (m % 2 == 0, m % 3 == 0) {
        (true, true) => 6 * m,
        (true, false) => 2 * m,
        (false, true) => 3 * m,
        _ => m,
    }
}

/// Normalized in-band noise floor at the VCO: −231 + 10log(fPFD) + 20log(N).
pub fn inband_floor(f_pfd: f64, n: f64) -> f64 {
    -231.0 + 10.0 * f_pfd.max(1.0).log10() + 20.0 * n.max(1.0).log10()
}

pub fn derive(words: &Words, f_ref: f64, rcp_ohm: f64) -> Derived {
    let g = |n: &str| regs::get(words, n);
    let mut d = Derived { f_ref, ..Default::default() };
    let iss = &mut d.issues;

    d.doubler = g("REF_DOUBLER") == 1;
    d.div2 = g("REF_DIV2") == 1;
    d.r = g("R_COUNTER");
    d.f_doubled = f_ref * if d.doubler { 2.0 } else { 1.0 };
    d.f_r = if d.r > 0 { d.f_doubled / d.r as f64 } else { 0.0 };
    d.f_pfd = d.f_r / if d.div2 { 2.0 } else { 1.0 };
    d.t_pfd_ns = if d.f_pfd > 0.0 { 1e9 / d.f_pfd } else { 0.0 };

    let (frac, modulus, phase, hi) = regs::frac_mod_phase(words);
    d.int = g("INT");
    d.frac = frac;
    d.modulus = modulus;
    d.phase = phase;
    d.hi_res = hi;
    d.sdm_order = g("SDM_ORDER");
    let frac_active = d.frac != 0 && d.sdm_order != 0 && d.modulus >= 2;
    d.integer_mode = !frac_active;
    d.n = d.int as f64 + if frac_active { d.frac as f64 / d.modulus as f64 } else { 0.0 };

    d.m0 = regs::rf_div_value(g("RF_DIV"));
    d.fb_fundamental = g("FEEDBACK_SEL") == 1;
    if d.fb_fundamental {
        d.f_vco = d.f_pfd * d.n;
        d.n_loop = d.n;
    } else {
        d.f_vco = d.f_pfd * d.n * d.m0 as f64;
        d.n_loop = d.n * d.m0 as f64;
    }
    d.vco_core = vco_core(d.f_vco);
    d.f_div_out = d.f_vco / d.m0 as f64;
    d.out_a_en = g("RF_OUTA_EN") == 1;
    d.out_b_en = g("RF_OUTB_EN") == 1 && d.out_a_en;
    d.f_out_a = d.f_div_out;
    d.f_out_b = if g("RF_OUTB_SEL") == 1 { d.f_vco } else { d.f_div_out };
    d.pwr_a_dbm = regs::out_power_dbm(g("RF_OUTA_PWR"), g("RF_OUTA_HI_PWR") == 1);
    d.pwr_b_dbm = regs::out_power_dbm(g("RF_OUTB_PWR"), g("RF_OUTB_HI_PWR") == 1);

    d.band_sel_div = g("BAND_SEL_DIV") + 256 * g("EXT_BAND_SEL_DIV");
    d.f_band_sel = if d.band_sel_div > 0 { d.f_pfd / d.band_sel_div as f64 } else { 0.0 };
    let step_vco = if d.modulus > 0 { d.f_pfd / d.modulus as f64 } else { 0.0 };
    d.channel_step_hz = if d.fb_fundamental { step_vco / d.m0 as f64 } else { step_vco };
    d.phase_deg = if d.modulus > 0 { 360.0 * d.phase as f64 / d.modulus as f64 } else { 0.0 };
    d.phase_step_deg = if d.modulus > 0 { 360.0 / d.modulus as f64 } else { 0.0 };
    d.icp_ma = regs::icp_amps(g("ICP"), rcp_ohm) * 1e3;
    d.ld_window_ns = regs::ld_window_ns(g("LDP"), g("LDP_EXT"));
    d.ld_cycles = if g("LDF") == 1 { 5 } else { 40 };
    let mod_for_sync = if d.hi_res { d.modulus.min(4095) } else { d.modulus };
    d.t_sync_s = g("CLK_DIV") as f64 * mod_for_sync as f64 / d.f_pfd.max(1.0);
    d.frac_spur_step_hz = if frac_active { d.f_pfd / frac_repeat_len(d.modulus) as f64 } else { 0.0 };
    d.ibs_offset_hz = if frac_active && d.f_pfd > 0.0 && d.fb_fundamental {
        let k = (d.f_vco / d.f_pfd).round();
        Some((d.f_vco - k * d.f_pfd).abs())
    } else {
        None
    };
    d.inband_floor_dbc = inband_floor(d.f_pfd, d.n_loop) - 20.0 * (d.m0 as f64).log10();

    // ── validation ──
    if !(REF_MIN..=REF_MAX).contains(&f_ref) {
        issue(iss, Level::Error, "ref", format!("REF_IN = {} вне диапазона 5…310 МГц", mhz(f_ref)));
    }
    if d.doubler && f_ref > REF_MAX_DOUBLER {
        issue(iss, Level::Error, "doubler", "С удвоителем REF_IN должен быть ≤ 100 МГц");
    }
    if d.r == 0 {
        issue(iss, Level::Error, "rdiv", "R = 0 запрещено");
    }
    if d.int < INT_MIN {
        issue(iss, Level::Error, "ndiv", format!("INT = {} < 8 — запрещённое значение", d.int));
    } else if frac_active && d.int < 12 {
        issue(iss, Level::Warn, "ndiv", "ΣΔ 3-го порядка модулирует N на −3…+4: при INT < 12 возможна неустойчивость делителя");
    }
    if d.modulus < 2 {
        issue(iss, Level::Error, "ndiv", "MOD < 2 запрещено");
    }
    if d.frac >= d.modulus && d.modulus >= 2 {
        issue(iss, Level::Error, "ndiv", format!("FRAC ({}) должен быть меньше MOD ({})", d.frac, d.modulus));
    }
    if d.frac != 0 && d.sdm_order == 0 {
        issue(iss, Level::Warn, "sdm", "SDM_ORDER = 0: дробная часть игнорируется (целочисленный режим)");
    }
    if frac_active && d.f_pfd > PFD_MAX_FRAC {
        issue(iss, Level::Error, "pfd", format!("fPFD = {} > 125 МГц — предел дробного режима", mhz(d.f_pfd)));
    } else if d.f_pfd > PFD_MAX_INT {
        issue(iss, Level::Error, "pfd", format!("fPFD = {} > 310 МГц", mhz(d.f_pfd)));
    }
    if d.f_pfd > 0.0 && d.f_pfd < 500e3 {
        issue(iss, Level::Warn, "pfd", "fPFD < 500 кГц: медленная калибровка и узкая полоса петли");
    }
    if d.f_vco > 0.0 && !(VCO_MIN..=VCO_MAX).contains(&d.f_vco) {
        issue(iss, Level::Error, "vco", format!("fVCO = {} вне диапазона ГУН 2200…4400 МГц", mhz(d.f_vco)));
    }
    if g("RF_DIV") == 7 {
        issue(iss, Level::Error, "m0", "RF_DIV = 111 зарезервировано");
    }
    let bs_max = if g("BAND_SEL_CLK_MODE") == 1 { 500e3 } else { 125e3 };
    if d.band_sel_div == 0 || g("BAND_SEL_DIV") == 0 {
        issue(iss, Level::Error, "vco", "BAND_SEL_DIV = 0 запрещено");
    } else if d.f_band_sel > bs_max * 1.0001 {
        issue(iss, Level::Warn, "vco", format!(
            "Такт выбора диапазона {} выше допустимых {} — увеличьте BAND_SEL_DIV",
            khz(d.f_band_sel), khz(bs_max)));
    }
    if g("BAND_SEL_CLK_MODE") == 1 && g("BAND_SEL_DIV") > 254 {
        issue(iss, Level::Warn, "vco", "В режиме High BAND_SEL_DIV должен быть ≤ 254");
    }
    if d.t_pfd_ns > 0.0 && d.ld_window_ns >= d.t_pfd_ns {
        issue(iss, Level::Warn, "ld", format!(
            "Окно Lock Detect {:.1} нс ≥ периода PFD {:.2} нс — LD будет ложно показывать захват",
            d.ld_window_ns, d.t_pfd_ns));
    }
    if frac_active && g("LDF") == 1 {
        issue(iss, Level::Info, "ld", "В дробном режиме рекомендуется LDF = 40 циклов");
    }
    if g("RF_OUTB_EN") == 1 && !d.out_a_en {
        issue(iss, Level::Warn, "outb", "RF_OUTB работает только при включённом RF_OUTA");
    }
    if !d.out_a_en {
        issue(iss, Level::Info, "outa", "Выходы выключены (RF_OUTA_EN = 0)");
    }
    if g("POWER_DOWN") == 1 {
        issue(iss, Level::Warn, "logic", "Включён программный Power Down");
    }
    if g("CP_HIGHZ") == 1 {
        issue(iss, Level::Warn, "cp", "Charge pump в Hi-Z — петля разомкнута");
    }
    if g("VCO_POWER_DOWN") == 1 {
        issue(iss, Level::Warn, "vco", "ГУН выключен (VCO_POWER_DOWN)");
    }
    if g("PD_POLARITY") == 0 {
        issue(iss, Level::Warn, "pfd", "Отрицательная полярность PFD — только для инвертирующего активного фильтра");
    }
    if !d.fb_fundamental && frac_active {
        issue(iss, Level::Info, "fbmux", "Обратная связь с делителя M0 в дробном режиме ухудшает фазовый шум");
    }
    if let Some(o) = d.ibs_offset_hz {
        if o < 200e3 && o > 0.0 {
            issue(iss, Level::Warn, "ndiv", format!(
                "Целочисленный граничный паразит на отстройке {} — внутри полосы петли", khz(o)));
        }
    }
    for (name, bad, block) in [
        ("MUX_OUT", 5, "mux"),
        ("SDM_TYPE", 0, "sdm"),
        ("CLK_DIV_MODE", 3, "fastlock"),
        ("BAND_SEL_ACC", 3, "vco"),
    ] {
        if g(name) == bad {
            issue(iss, Level::Warn, block, format!("{} = {} — зарезервированное значение", name, bad));
        }
    }
    let nm = g("NOISE_MODE");
    if nm == 1 || nm == 2 {
        issue(iss, Level::Warn, "sdm", "NOISE_MODE 01/10 зарезервированы — используйте 00 или 11");
    }
    d
}

pub fn mhz(f: f64) -> String {
    format!("{:.6} МГц", f / 1e6).replace(".000000", "")
}
pub fn khz(f: f64) -> String {
    format!("{:.1} кГц", f / 1e3)
}

// ─────────────────────────── planner ───────────────────────────

#[derive(Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Tri {
    #[default]
    Auto,
    On,
    Off,
}

fn default_pfd_max() -> f64 {
    PFD_MAX_FRAC
}
fn default_true() -> bool {
    true
}
fn default_bw() -> f64 {
    100e3
}
fn default_count() -> usize {
    8
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct PlanRequest {
    pub target_hz: f64,
    pub ref_hz: f64,
    #[serde(default)]
    pub channel_step_hz: Option<f64>,
    #[serde(default)]
    pub doubler: Tri,
    #[serde(default)]
    pub div2: Tri,
    #[serde(default)]
    pub r_fixed: Option<u32>,
    #[serde(default = "default_pfd_max")]
    pub pfd_max_hz: f64,
    #[serde(default = "default_true")]
    pub allow_16bit: bool,
    #[serde(default)]
    pub prefer_integer: bool,
    #[serde(default = "default_bw")]
    pub loop_bw_hz: f64,
    #[serde(default = "default_count")]
    pub count: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct Candidate {
    pub r: u32,
    pub doubler: bool,
    pub div2: bool,
    pub f_pfd: f64,
    pub int: u32,
    pub frac: u32,
    pub modulus: u32,
    pub hi_res: bool,
    pub m0: u32,
    pub f_vco: f64,
    pub f_out: f64,
    pub error_hz: f64,
    pub integer_mode: bool,
    pub inband_dbc: f64,
    pub ibs_offset_hz: Option<f64>,
    pub frac_spur_step_hz: f64,
    pub score: f64,
    pub notes: Vec<String>,
    pub fields: BTreeMap<String, u32>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PlanResult {
    pub m0: u32,
    pub f_vco_target: f64,
    pub candidates: Vec<Candidate>,
    pub error: Option<String>,
}

fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

/// Best rational approximation p/q of x = num/den (0 ≤ x < 1) with q ≤ max_den.
pub fn best_rational(num: u128, den: u128, max_den: u128) -> (u128, u128) {
    if num == 0 {
        return (0, 1);
    }
    let g = gcd(num, den);
    let (n, d) = (num / g, den / g);
    if d <= max_den {
        return (n, d);
    }
    // continued fraction convergents with semiconvergents
    let (mut p0, mut q0, mut p1, mut q1) = (0u128, 1u128, 1u128, 0u128);
    let (mut a_num, mut a_den) = (n, d);
    let target = n as f64 / d as f64;
    let mut best = (0u128, 1u128);
    loop {
        if a_den == 0 {
            break;
        }
        let a = a_num / a_den;
        let p2 = a * p1 + p0;
        let q2 = a * q1 + q0;
        if q2 > max_den {
            // semiconvergent
            let k = (max_den - q0) / q1.max(1);
            let ps = k * p1 + p0;
            let qs = k * q1 + q0;
            let e_semi = (ps as f64 / qs as f64 - target).abs();
            let e_conv = (p1 as f64 / q1.max(1) as f64 - target).abs();
            best = if qs > 0 && e_semi < e_conv { (ps, qs) } else { (p1, q1) };
            break;
        }
        p0 = p1;
        q0 = q1;
        p1 = p2;
        q1 = q2;
        best = (p1, q1);
        let r = a_num - a * a_den;
        a_num = a_den;
        a_den = r;
    }
    best
}

pub struct BandSelCfg {
    pub div: u32,
    pub high: bool,
}

pub fn band_select_cfg(f_pfd: f64) -> BandSelCfg {
    if f_pfd <= 125e3 {
        return BandSelCfg { div: 1, high: false };
    }
    let div_hi = (f_pfd / 500e3).ceil() as u32;
    let mut cfg = if div_hi <= 254 {
        BandSelCfg { div: div_hi.max(1), high: true }
    } else {
        BandSelCfg { div: ((f_pfd / 125e3).ceil() as u32).min(4095), high: false }
    };
    if cfg.div % 256 == 0 {
        cfg.div += 1;
    }
    cfg
}

pub fn ld_cfg(f_pfd: f64) -> (u32, u32) {
    let t_ns = 1e9 / f_pfd.max(1.0);
    for (ldp, ext, w) in regs::ld_window_options() {
        if w < t_ns {
            return (ldp, ext);
        }
    }
    (0, 3)
}

pub fn plan(req: &PlanRequest) -> PlanResult {
    let mut res = PlanResult { m0: 0, f_vco_target: 0.0, candidates: vec![], error: None };
    let t = req.target_hz;
    if !(OUT_MIN * 0.999_999..=OUT_MAX).contains(&t) {
        res.error = Some(format!("Частота {} вне диапазона 34.375 МГц … 4.4 ГГц", mhz(t)));
        return res;
    }
    if !(REF_MIN..=REF_MAX).contains(&req.ref_hz) {
        res.error = Some("Опорная частота вне диапазона 5…310 МГц".into());
        return res;
    }
    let mut m0 = 1u32;
    while t * (m0 as f64) < VCO_MIN && m0 < 64 {
        m0 *= 2;
    }
    let f_vco_t = t * m0 as f64;
    if f_vco_t > VCO_MAX * 1.000_001 || f_vco_t < VCO_MIN * 0.999_999 {
        res.error = Some("Невозможно попасть в диапазон ГУН ни с одним делителем M0".into());
        return res;
    }
    res.m0 = m0;
    res.f_vco_target = f_vco_t;

    let ref_mhz = (req.ref_hz * 1000.0).round() as u128; // milli-hertz
    let vco_mhz = ((t * 1000.0).round() as u128) * m0 as u128;
    let max_den: u128 = if req.allow_16bit { 65535 } else { 4095 };

    let ds: Vec<bool> = match req.doubler {
        Tri::Auto => {
            if req.ref_hz <= REF_MAX_DOUBLER {
                vec![false, true]
            } else {
                vec![false]
            }
        }
        Tri::On => vec![true],
        Tri::Off => vec![false],
    };
    let ts: Vec<bool> = match req.div2 {
        Tri::Auto => vec![false, true],
        Tri::On => vec![true],
        Tri::Off => vec![false],
    };
    let rs: Vec<u32> = match req.r_fixed {
        Some(r) if (1..=1023).contains(&r) => vec![r],
        _ => (1..=1023).collect(),
    };

    let mut all: Vec<Candidate> = Vec::new();
    for &dbl in &ds {
        for &dv2 in &ts {
            for &r in &rs {
                let f_pfd = req.ref_hz * if dbl { 2.0 } else { 1.0 } / (r as f64 * if dv2 { 2.0 } else { 1.0 });
                if f_pfd < 500e3 || f_pfd > req.pfd_max_hz.min(PFD_MAX_INT) {
                    continue;
                }
                // N = vco * R * (1+T) / (ref * (1+D))  — exact rational
                let num = vco_mhz * r as u128 * if dv2 { 2 } else { 1 };
                let den = ref_mhz * if dbl { 2 } else { 1 };
                let int = (num / den) as u64;
                if int < INT_MIN as u64 || int > 65535 {
                    continue;
                }
                let rem = num % den;
                let (frac, modulus, hi_res, integer_mode) = if rem == 0 {
                    (0u32, 2u32, false, true)
                } else if let Some(step) = req.channel_step_hz.filter(|s| *s > 0.0) {
                    let m = (f_pfd / (step * m0 as f64)).round().max(2.0) as u128;
                    if m > max_den {
                        continue;
                    }
                    let fr = ((rem as f64 / den as f64) * m as f64).round() as u128;
                    if fr >= m {
                        continue;
                    }
                    (fr as u32, m as u32, m > 4095, fr == 0)
                } else {
                    let (p, q) = best_rational(rem, den, max_den);
                    let (p, q) = if q < 2 { (p * 2, 2) } else { (p, q) };
                    if p == 0 {
                        (0, 2, false, true)
                    } else if p >= q {
                        continue;
                    } else {
                        (p as u32, q as u32, q > 4095, false)
                    }
                };
                if !integer_mode && f_pfd > PFD_MAX_FRAC {
                    continue;
                }
                if !integer_mode && int < 12 {
                    continue;
                }
                let n_act = int as f64 + frac as f64 / modulus as f64;
                let f_vco = f_pfd * n_act;
                let f_out = f_vco / m0 as f64;
                let err = f_out - t;
                let inband = inband_floor(f_pfd, n_act) - 20.0 * (m0 as f64).log10();
                let ibs = if integer_mode {
                    None
                } else {
                    let k = (f_vco / f_pfd).round();
                    Some((f_vco - k * f_pfd).abs())
                };
                let fstep = if integer_mode { 0.0 } else { f_pfd / frac_repeat_len(modulus) as f64 };
                let mut score = inband;
                let mut notes = vec![];
                if integer_mode {
                    notes.push("Integer-N: нет дробных паразитных".to_string());
                } else {
                    score += 2.0;
                    if req.prefer_integer {
                        score += 20.0;
                    }
                }
                if let Some(o) = ibs {
                    if o < 3.0 * req.loop_bw_hz {
                        score += 10.0;
                        notes.push(format!("Граничный паразит {} внутри полосы", khz(o)));
                    } else if o < 10.0 * req.loop_bw_hz {
                        score += 4.0;
                        notes.push(format!("Граничный паразит {} близко к полосе", khz(o)));
                    }
                }
                if dbl {
                    score += 0.3;
                    notes.push("Удвоитель опоры".into());
                }
                if dv2 {
                    score += 0.2;
                }
                if hi_res {
                    notes.push("16-битный режим MOD".into());
                }
                if err.abs() > 0.5 {
                    notes.push(format!("Ошибка частоты {:+.3} Гц", err));
                }
                score += r as f64 * 1e-4;

                let mut w = regs::defaults();
                regs::set(&mut w, "INT", int as u32);
                regs::set_frac_mod_phase(&mut w, frac, modulus, if hi_res { 16 } else { 1 }, hi_res);
                let bs = band_select_cfg(f_pfd);
                let (ldp, ldp_ext) = ld_cfg(f_pfd);
                let mut fields = BTreeMap::new();
                for n in ["INT", "FRAC", "MOD", "PHASE", "RES_16BIT", "EXT_FRAC", "EXT_MOD", "EXT_PHASE"] {
                    fields.insert(n.to_string(), regs::get(&w, n));
                }
                fields.insert("R_COUNTER".into(), r);
                fields.insert("REF_DOUBLER".into(), dbl as u32);
                fields.insert("REF_DIV2".into(), dv2 as u32);
                fields.insert("RF_DIV".into(), m0.trailing_zeros());
                fields.insert("FEEDBACK_SEL".into(), 1);
                fields.insert("BAND_SEL_DIV".into(), bs.div % 256);
                fields.insert("EXT_BAND_SEL_DIV".into(), bs.div / 256);
                fields.insert("BAND_SEL_CLK_MODE".into(), bs.high as u32);
                fields.insert("LDF".into(), integer_mode as u32);
                fields.insert("LDP".into(), ldp);
                fields.insert("LDP_EXT".into(), ldp_ext);

                all.push(Candidate {
                    r,
                    doubler: dbl,
                    div2: dv2,
                    f_pfd,
                    int: int as u32,
                    frac,
                    modulus,
                    hi_res,
                    m0,
                    f_vco,
                    f_out,
                    error_hz: err,
                    integer_mode,
                    inband_dbc: inband,
                    ibs_offset_hz: ibs,
                    frac_spur_step_hz: fstep,
                    score,
                    notes,
                    fields,
                });
            }
        }
    }
    // exact (|err| < 0.5 Hz) first, then score
    all.sort_by(|a, b| {
        let ea = (a.error_hz.abs() >= 0.5) as u8;
        let eb = (b.error_hz.abs() >= 0.5) as u8;
        ea.cmp(&eb)
            .then(a.error_hz.abs().partial_cmp(&b.error_hz.abs()).unwrap().then(std::cmp::Ordering::Equal))
            .then(a.score.partial_cmp(&b.score).unwrap())
    });
    // Re-sort exact group purely by score, keep error ordering for inexact ones.
    let split = all.iter().position(|c| c.error_hz.abs() >= 0.5).unwrap_or(all.len());
    all[..split].sort_by(|a, b| a.score.partial_cmp(&b.score).unwrap());
    let mut seen: Vec<u64> = vec![];
    let mut out = vec![];
    for c in all {
        let key = (c.f_pfd * 1000.0).round() as u64;
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        out.push(c);
        if out.len() >= req.count.max(1) {
            break;
        }
    }
    if out.is_empty() {
        res.error = Some("Не найдено допустимых конфигураций — ослабьте ограничения (шаг сетки, fPFD max, R)".into());
    }
    res.candidates = out;
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(t: f64) -> PlanRequest {
        PlanRequest {
            target_hz: t,
            ref_hz: 25e6,
            channel_step_hz: None,
            doubler: Tri::Auto,
            div2: Tri::Auto,
            r_fixed: None,
            pfd_max_hz: 125e6,
            allow_16bit: true,
            prefer_integer: false,
            loop_bw_hz: 100e3,
            count: 8,
        }
    }

    #[test]
    fn default_registers_give_2500mhz() {
        let d = derive(&regs::defaults(), 25e6, 5100.0);
        assert!((d.f_vco - 2500e6).abs() < 1.0);
        assert!(d.integer_mode);
        assert_eq!(d.m0, 1);
        assert!(d.issues.iter().all(|i| i.level != Level::Error), "{:?}", d.issues);
    }

    #[test]
    fn vendor_timing_commander_examples() {
        // IDT example .tcs files, 2015-05-20, Byte# 00..07, RF_IN=25 MHz.
        // Source: 8V97051_Example_Timing_Commander_Configuration_Files.zip.
        // Keep only numeric test vectors; CI does not need the local info/ archive.
        let cases: [(f64, Words); 6] = [
            (1525680000.0, [0x001e8370, 0x00007ef1, 0x62006442, 0x0080832b, 0x009652bc, 0x00400005, 0x00c40006, 0x02d08887]),
            (1650000000.0, [0x00210000, 0x00007ff9, 0x02006542, 0x0080832b, 0x009652bc, 0x00400005, 0x00040006, 0x02d0f087]),
            (2200000000.0, [0x00160000, 0x00007ff9, 0x02006342, 0x0080832b, 0x008652bc, 0x00400005, 0x00040006, 0x02d0f087]),
            (4400000000.0, [0x002c0000, 0x00007ff9, 0x02006742, 0x0080832b, 0x008652bc, 0x00400005, 0x00040006, 0x02d0f087]),
            (695680000.0, [0x001bd310, 0x00007ef1, 0x62006442, 0x0080832b, 0x00a652bc, 0x00400005, 0x00c40006, 0x02d08887]),
            (700000000.0, [0x001c0000, 0x00007ff9, 0x02006542, 0x0080832b, 0x00a652bc, 0x00400005, 0x00040006, 0x02d0f087]),
        ];
        for (expected_hz, words) in cases {
            let d = derive(&words, 25e6, 4700.0);
            assert!((d.f_out_a - expected_hz).abs() < 1.0, "{}: {}", expected_hz, d.f_out_a);
            assert_eq!(d.f_pfd, 50e6);
            assert!(d.out_a_en);
            assert!(!d.out_b_en);
        }
    }

    #[test]
    fn plans_exact_fractional() {
        let r = plan(&req(1_234_567_890.0));
        assert!(r.error.is_none(), "{:?}", r.error);
        let c = &r.candidates[0];
        assert!(c.error_hz.abs() < 0.5, "error {}", c.error_hz);
        assert_eq!(c.m0, 2);
        assert!(!c.integer_mode);
    }

    #[test]
    fn plans_integer_when_possible() {
        let r = plan(&req(2_400e6));
        let c = &r.candidates[0];
        assert!(c.integer_mode);
        assert_eq!(c.error_hz, 0.0);
    }

    #[test]
    fn lowest_frequency() {
        let r = plan(&req(34.375e6));
        assert_eq!(r.m0, 64);
        assert!(!r.candidates.is_empty());
    }

    #[test]
    fn channel_step() {
        let mut q = req(2_412_100_000.0);
        q.channel_step_hz = Some(100e3);
        q.doubler = Tri::Off;
        q.div2 = Tri::Off;
        q.r_fixed = Some(1);
        let r = plan(&q);
        let c = &r.candidates[0];
        assert_eq!(c.modulus, 250);
        assert!(c.error_hz.abs() < 1e-3);
    }

    #[test]
    fn best_rational_works() {
        assert_eq!(best_rational(1, 3, 4095), (1, 3));
        let (p, q) = best_rational(314159265, 1000000000, 4095);
        assert!(q <= 4095);
        assert!((p as f64 / q as f64 - 0.314159265).abs() < 1e-6);
    }
}
