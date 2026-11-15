//! Signal-generator helpers: output level table and the estimate of what an
//! oscilloscope of a given bandwidth shows on RF_OUTA.

use crate::plan::{OUT_MAX, OUT_MIN};
use serde::{Deserialize, Serialize};

/// Output levels of RF_OUTA: (dBm, RF_OUTA_PWR code, RF_OUTA_HI_PWR).
/// Datasheet: HI_PWR = 0 → −4/−1/+2/+5 dBm, HI_PWR = 1 → +2/+5/+6/+7 dBm.
pub const LEVELS: &[(f64, u32, bool)] = &[
    (-4.0, 0, false),
    (-1.0, 1, false),
    (2.0, 2, false),
    (5.0, 3, false),
    (6.0, 2, true),
    (7.0, 3, true),
];

/// Nearest supported level → (RF_OUTA_PWR, RF_OUTA_HI_PWR).
pub fn level_code(dbm: f64) -> (f64, u32, bool) {
    *LEVELS
        .iter()
        .min_by(|a, b| (a.0 - dbm).abs().total_cmp(&(b.0 - dbm).abs()))
        .expect("level table")
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Preset {
    pub name: String,
    pub hz: f64,
    pub level_dbm: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Harmonic {
    pub n: u32,
    pub f_hz: f64,
    /// Amplitude at the scope input after attenuation, before the scope filter (V peak).
    pub vpk_in: f64,
    /// Amplitude after the scope front-end (Gaussian response, −3 dB at bw), V peak.
    pub vpk_seen: f64,
    pub gain_db: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct ScopeView {
    pub f_out: f64,
    pub bw_hz: f64,
    pub in_band: bool,
    pub level_dbm: f64,
    /// Power at the scope after the attenuator, dBm.
    pub at_scope_dbm: f64,
    /// Fundamental peak-to-peak into 50 Ω (no scope roll-off), V.
    pub vpp_50: f64,
    /// Peak-to-peak of the fundamental seen through the scope bandwidth, V.
    pub vpp_seen: f64,
    pub rolloff_db: f64,
    pub harmonics: Vec<Harmonic>,
    pub sine_like: bool,
    pub t_div_s: f64,
    pub v_div: f64,
    pub sample_rate_min: f64,
    pub notes: Vec<String>,
}

/// Gaussian-like scope front end: |H| = 10^(−3/20 · (f/bw)²).
fn scope_gain_db(f: f64, bw: f64) -> f64 {
    -3.0 * (f / bw).powi(2)
}

/// Rounds up to the 1-2-5 sequence.
fn ceil_125(x: f64) -> f64 {
    if x.is_nan() || x <= 0.0 {
        return 0.0;
    }
    let e = x.log10().floor();
    let base = 10f64.powf(e);
    for m in [1.0, 2.0, 5.0, 10.0] {
        if m * base >= x * 0.999_999 {
            return m * base;
        }
    }
    10.0 * base
}

/// What a scope with bandwidth `bw_hz` and 50 Ω input shows on RF_OUTA.
/// The output stage after the M0 divider is treated as a square wave with
/// the datasheet fundamental power; odd harmonics fall as 1/n.
pub fn scope_view(f_out: f64, level_dbm: f64, live: bool, bw_hz: f64, atten_db: f64) -> ScopeView {
    let bw = bw_hz.max(1e6);
    let at = level_dbm - atten_db.max(0.0);
    let vpk1 = if live { (2.0 * 50.0 * 10f64.powf(at / 10.0) * 1e-3).sqrt() } else { 0.0 };
    let mut harmonics = vec![];
    for n in [1u32, 3, 5, 7] {
        let f = f_out * n as f64;
        if n > 1 && f > 3.0 * bw {
            break;
        }
        let g = scope_gain_db(f, bw);
        let vin = vpk1 / n as f64;
        harmonics.push(Harmonic { n, f_hz: f, vpk_in: vin, vpk_seen: vin * 10f64.powf(g / 20.0), gain_db: g });
    }
    let rolloff = scope_gain_db(f_out, bw);
    let vpp_50 = 2.0 * vpk1;
    let vpp_seen = vpp_50 * 10f64.powf(rolloff / 20.0);
    // 3rd harmonic below −20 dB relative → the trace looks like a sine
    let sine_like = harmonics.iter().find(|h| h.n == 3).map(|h| h.vpk_seen < 0.1 * vpk1).unwrap_or(true);
    let t_div = if f_out > 0.0 { ceil_125(4.0 / f_out / 10.0) } else { 0.0 };
    // true peak of the band-limited trace over one period
    let peak = (0..400)
        .map(|i| {
            let ph = i as f64 / 400.0 * std::f64::consts::TAU;
            harmonics.iter().map(|h| h.vpk_seen * (h.n as f64 * ph).sin()).sum::<f64>().abs()
        })
        .fold(vpp_seen / 2.0, f64::max);
    // fill about six of eight vertical divisions
    let v_div = ceil_125((2.0 * peak / 6.0).max(1e-3));

    let mut notes = vec![];
    if f_out > bw {
        notes.push(format!(
            "Частота выше полосы осциллографа: амплитуда занижена на {:.1} дБ, измеряйте анализатором спектра.",
            -rolloff
        ));
    } else if f_out > 0.7 * bw {
        notes.push(format!("Близко к границе полосы: показанная амплитуда меньше реальной на {:.1} дБ.", -rolloff));
    }
    if !sine_like {
        notes.push("3-я гармоника проходит в полосу: форма близка к трапеции (выход делителя прямоугольный).".into());
    }
    if !live {
        notes.push("RF-выход выключен — на экране будет только шум.".into());
    }
    if at > 10.0 {
        notes.push("Мощность на входе выше +10 dBm — проверьте допустимый уровень входа 50 Ом.".into());
    }
    ScopeView {
        f_out,
        bw_hz: bw,
        in_band: f_out <= bw,
        level_dbm,
        at_scope_dbm: at,
        vpp_50,
        vpp_seen,
        rolloff_db: rolloff,
        harmonics,
        sine_like,
        t_div_s: t_div,
        v_div,
        sample_rate_min: 2.5 * bw,
        notes,
    }
}

pub fn range() -> (f64, f64) {
    (OUT_MIN, OUT_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_map_to_datasheet_codes() {
        for &(dbm, code, hi) in LEVELS {
            assert_eq!(crate::regs::out_power_dbm(code, hi), dbm);
            assert_eq!(level_code(dbm + 0.3), (dbm, code, hi));
        }
    }

    #[test]
    fn scope_estimate() {
        // +5 dBm into 50 Ω ≈ 1.12 Vpp
        let v = scope_view(100e6, 5.0, true, 600e6, 0.0);
        assert!((v.vpp_50 - 1.125).abs() < 0.01, "{}", v.vpp_50);
        assert!(v.in_band && !v.sine_like);
        assert_eq!(v.t_div_s, 5e-9);
        let v = scope_view(600e6, 5.0, true, 600e6, 10.0);
        assert!((v.rolloff_db + 3.0).abs() < 1e-9 && v.sine_like);
        assert!(!scope_view(1e9, 5.0, true, 600e6, 0.0).in_band);
        assert_eq!(ceil_125(0.031), 0.05);
    }
}
