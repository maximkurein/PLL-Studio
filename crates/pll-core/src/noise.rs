//! Phase-noise / jitter / spur model of the closed loop, plus a virtual
//! spectrum analyzer. Anchored to the datasheet figures:
//! normalized floor −231 dBc/Hz, 1/f −122.8 dBc/Hz (10 kHz, 1 GHz),
//! open-loop VCO curves (Table 15B), harmonics, PFD spur −74 dBc @ 50 MHz.

use crate::loopfilter::{closed_loop, logspace, LoopFilter, LoopParams};
use crate::plan::Derived;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

pub const OUTPUT_FLOOR_DBC: f64 = -158.0;

/// Open-loop VCO phase noise rows: (fVCO MHz, [L @ 100k, 800k, 1M, 5M, 10M, 30M]).
/// 2200 and 3300 rows are derived from the ÷2 measurements (1.1 / 1.65 GHz) + 6 dB.
const VCO_OFFS: [f64; 6] = [1e5, 8e5, 1e6, 5e6, 1e7, 3e7];
const VCO_ROWS: [(f64, [f64; 6]); 5] = [
    (2200.0, [-112.38, -134.98, -136.98, -150.8, -153.8, -155.1]),
    (2300.0, [-112.1, -135.7, -137.8, -150.8, -153.8, -155.1]),
    (3300.0, [-106.18, -130.88, -133.18, -149.5, -153.0, -154.9]),
    (3800.0, [-106.0, -130.9, -133.2, -148.1, -152.2, -154.7]),
    (4400.0, [-102.0, -127.0, -129.5, -146.0, -150.5, -153.0]),
];

fn interp_log(xs: &[f64], ys: &[f64], x: f64) -> f64 {
    let lx = x.log10();
    if x <= xs[0] {
        return ys[0];
    }
    for i in 0..xs.len() - 1 {
        if x <= xs[i + 1] {
            let (a, b) = (xs[i].log10(), xs[i + 1].log10());
            let t = (lx - a) / (b - a);
            return ys[i] + t * (ys[i + 1] - ys[i]);
        }
    }
    *ys.last().unwrap()
}

/// Free-running VCO noise at the VCO frequency (dBc/Hz).
pub fn vco_open_loop(f_vco: f64, off: f64) -> f64 {
    let fm = (f_vco / 1e6).clamp(2200.0, 4400.0);
    let row = |r: &[f64; 6]| -> f64 {
        if off < VCO_OFFS[0] {
            r[0] + 30.0 * (VCO_OFFS[0] / off).log10()
        } else {
            interp_log(&VCO_OFFS, r, off)
        }
    };
    for i in 0..VCO_ROWS.len() - 1 {
        let (f0, r0) = VCO_ROWS[i];
        let (f1, r1) = VCO_ROWS[i + 1];
        if fm <= f1 {
            let t = (fm - f0) / (f1 - f0);
            return row(&r0) * (1.0 - t) + row(&r1) * t;
        }
    }
    row(&VCO_ROWS[4].1)
}

pub fn default_ref_noise() -> Vec<(f64, f64)> {
    // Typical 25 MHz TCXO
    vec![(10.0, -88.0), (100.0, -118.0), (1e3, -138.0), (1e4, -150.0), (1e5, -155.0), (1e6, -157.0)]
}

fn ref_noise_at(pts: &[(f64, f64)], off: f64) -> f64 {
    if pts.is_empty() {
        return -200.0;
    }
    let xs: Vec<f64> = pts.iter().map(|p| p.0).collect();
    let ys: Vec<f64> = pts.iter().map(|p| p.1).collect();
    if off < xs[0] {
        return ys[0] + 30.0 * (xs[0] / off).log10();
    }
    interp_log(&xs, &ys, off)
}

fn db(x: f64) -> f64 {
    10.0 * x.max(1e-300).log10()
}
fn lin(d: f64) -> f64 {
    10f64.powf(d / 10.0)
}

#[derive(Serialize, Clone, Debug)]
pub struct Spur {
    pub offset_hz: f64,
    pub level_dbc: f64,
    pub kind: &'static str,
    pub label: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct NoiseResult {
    pub f: Vec<f64>,
    pub total: Vec<f64>,
    pub vco: Vec<f64>,
    pub pll: Vec<f64>,
    pub reference: Vec<f64>,
    pub sdm: Vec<f64>,
    pub floor: Vec<f64>,
    pub f_out: f64,
    pub f1: f64,
    pub f2: f64,
    pub jitter_fs: f64,
    pub phase_err_deg: f64,
    pub integrated_dbc: f64,
    pub spurs: Vec<Spur>,
    pub marks: Vec<(f64, f64)>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct NoiseOptions {
    pub f1: f64,
    pub f2: f64,
    /// Evaluate at RF_OUTB instead of RF_OUTA
    #[serde(default)]
    pub output_b: bool,
}

pub struct NoiseCtx<'a> {
    pub d: &'a Derived,
    pub lf: &'a LoopFilter,
    pub lp: LoopParams,
    pub ref_noise: &'a [(f64, f64)],
    pub dither: bool,
}

pub fn compute(ctx: &NoiseCtx, opt: &NoiseOptions) -> NoiseResult {
    let d = ctx.d;
    let f = logspace(100.0, 100e6, 421);
    let f_vco = d.f_vco.max(1.0);
    let div = if opt.output_b && d.f_out_b == d.f_vco { 1.0 } else { d.m0 as f64 };
    let f_out = f_vco / div;
    let div_db = 20.0 * div.log10();
    let floor_flat = -231.0 + 10.0 * d.f_pfd.max(1.0).log10() + 20.0 * d.n_loop.max(1.0).log10();
    let frac = !d.integer_mode;
    let m = d.sdm_order.clamp(1, 3) as i32;
    let mut r = NoiseResult { f_out, f1: opt.f1, f2: opt.f2, ..Default::default() };
    for &fi in &f {
        let (h, e) = closed_loop(ctx.lf, &ctx.lp, fi);
        let h2 = h.abs().powi(2);
        let e2 = e.abs().powi(2);
        let one_f = -122.8 + 20.0 * (f_vco / 1e9).log10() + 10.0 * (1e4 / fi).log10();
        let pll = db(lin(floor_flat) + lin(one_f)) + db(h2);
        let refn = ref_noise_at(ctx.ref_noise, fi) + 20.0 * (f_vco / d.f_ref.max(1.0)).log10() + db(h2);
        let sdm = if frac {
            let s = (2.0 * PI).powi(2) / (12.0 * d.f_pfd) * (2.0 * (PI * fi / d.f_pfd).sin()).powi(2 * (m - 1));
            db(s / 2.0) + db(h2) + if ctx.dither { 1.0 } else { 0.0 }
        } else {
            -250.0
        };
        let vco = vco_open_loop(f_vco, fi) + db(e2);
        let at_out = |x: f64| x - div_db;
        let (pll_o, ref_o, sdm_o, vco_o) = (at_out(pll), at_out(refn), at_out(sdm), at_out(vco));
        let tot = db(lin(pll_o) + lin(ref_o) + lin(sdm_o) + lin(vco_o) + lin(OUTPUT_FLOOR_DBC));
        r.pll.push(pll_o);
        r.reference.push(ref_o);
        r.sdm.push(sdm_o);
        r.vco.push(vco_o);
        r.floor.push(OUTPUT_FLOOR_DBC);
        r.total.push(tot);
    }
    // integrate
    let mut acc = 0.0;
    for i in 0..f.len() - 1 {
        let (a, b) = (f[i].max(opt.f1), f[i + 1].min(opt.f2));
        if b <= a {
            continue;
        }
        let pa = lin(interp_curve(&f, &r.total, a));
        let pb = lin(interp_curve(&f, &r.total, b));
        acc += 0.5 * (pa + pb) * (b - a);
    }
    let rad2 = 2.0 * acc;
    r.integrated_dbc = db(acc);
    r.phase_err_deg = rad2.sqrt().to_degrees();
    r.jitter_fs = rad2.sqrt() / (2.0 * PI * f_out) * 1e15;
    for off in [1e3, 1e4, 1e5, 1e6, 1e7] {
        r.marks.push((off, interp_curve(&f, &r.total, off)));
    }
    r.spurs = spurs(ctx, div);
    r.f = f;
    r
}

pub fn interp_curve(f: &[f64], y: &[f64], x: f64) -> f64 {
    interp_log(f, y, x)
}

pub fn spurs(ctx: &NoiseCtx, div: f64) -> Vec<Spur> {
    let d = ctx.d;
    let mut v = vec![];
    let div_db = 20.0 * div.log10();
    if d.f_pfd > 0.0 {
        // PFD reference spur: FM from charge-pump ripple through Z(fPFD).
        // Effective ripple current calibrated so a typical design hits the datasheet −74 dBc.
        let i_eff = 2.0e-3;
        for k in 1..=2 {
            let fo = d.f_pfd * k as f64;
            let z = ctx.lf.z(2.0 * PI * fo).abs();
            let beta = ctx.lp.kvco_hz_v * i_eff * z / fo;
            let l = 20.0 * (beta / 2.0).max(1e-12).log10() - div_db;
            v.push(Spur { offset_hz: fo, level_dbc: l.min(-40.0), kind: "pfd", label: format!("PFD ×{}", k) });
        }
    }
    if let Some(o) = d.ibs_offset_hz {
        if o > 1.0 {
            let (h, _) = closed_loop(ctx.lf, &ctx.lp, o);
            let l = -48.0 + 20.0 * h.abs().log10() - div_db;
            v.push(Spur { offset_hz: o, level_dbc: l, kind: "ibs", label: "Целочисленная граница".into() });
        }
    }
    if !d.integer_mode && d.frac_spur_step_hz > 0.0 {
        let base = if ctx.dither { -88.0 } else { -66.0 };
        let mut off = d.frac_spur_step_hz;
        let mut k = 0;
        while off < d.f_pfd / 2.0 && k < 6 {
            let (h, _) = closed_loop(ctx.lf, &ctx.lp, off);
            let l = base - 3.0 * k as f64 + 20.0 * h.abs().log10() - div_db;
            if Some(off) != d.ibs_offset_hz {
                v.push(Spur { offset_hz: off, level_dbc: l, kind: "frac", label: format!("Дробный #{}", k + 1) });
            }
            off += d.frac_spur_step_hz;
            k += 1;
        }
    }
    v.sort_by(|a, b| a.offset_hz.partial_cmp(&b.offset_hz).unwrap());
    v
}

/// (H2 dBc, H3 dBc) from the datasheet harmonics table, by output divider.
pub fn harmonics(m0: u32) -> (f64, f64) {
    match m0 {
        1 => (-40.0, -38.0),
        2 => (-47.0, -15.0),
        4 => (-52.0, -13.0),
        8 => (-57.0, -12.0),
        16 => (-61.0, -11.0),
        32 => (-64.0, -10.0),
        _ => (-53.0, -15.0),
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct SpectrumRequest {
    pub center_hz: Option<f64>,
    pub span_hz: f64,
    #[serde(default)]
    pub rbw_hz: Option<f64>,
    #[serde(default)]
    pub seed: u64,
    #[serde(default)]
    pub output_b: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Spectrum {
    pub f: Vec<f64>,
    pub dbm: Vec<f64>,
    pub center_hz: f64,
    pub span_hz: f64,
    pub rbw_hz: f64,
    pub carrier_dbm: f64,
    pub markers: Vec<(f64, f64, String)>,
}

pub fn spectrum(ctx: &NoiseCtx, nr: &NoiseResult, carrier_dbm: f64, req: &SpectrumRequest) -> Spectrum {
    let fc = nr.f_out;
    let center = req.center_hz.unwrap_or(fc);
    let span = req.span_hz.max(1e3);
    let npts = 1001usize;
    let rbw = req.rbw_hz.unwrap_or((span / 300.0).max(10.0));
    let sigma = rbw / 2.355;
    let danl = -165.0 + 10.0 * rbw.log10(); // analyzer displayed average noise level, dBm
    let mut seed = req.seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let mut rnd = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((seed >> 33) as f64 / (1u64 << 31) as f64) - 0.5
    };
    let div = if req.output_b && ctx.d.f_out_b == ctx.d.f_vco { 1.0 } else { ctx.d.m0 as f64 };
    let (h2, h3) = harmonics(div as u32);
    let mut lines: Vec<(f64, f64)> = vec![(fc, carrier_dbm)];
    for (k, l) in [(2.0, h2), (3.0, h3)] {
        lines.push((fc * k, carrier_dbm + l));
    }
    let mut out = Spectrum { center_hz: center, span_hz: span, rbw_hz: rbw, carrier_dbm, ..Default::default() };
    for s in &nr.spurs {
        lines.push((fc + s.offset_hz, carrier_dbm + s.level_dbc));
        lines.push((fc - s.offset_hz, carrier_dbm + s.level_dbc));
        if (fc + s.offset_hz - center).abs() < span / 2.0 {
            out.markers.push((fc + s.offset_hz, carrier_dbm + s.level_dbc, s.label.clone()));
        }
    }
    out.markers.insert(0, (fc, carrier_dbm, "Несущая".into()));
    for i in 0..npts {
        let fx = center - span / 2.0 + span * i as f64 / (npts - 1) as f64;
        let mut p = lin(danl + 1.5 * rnd());
        let off = (fx - fc).abs();
        if off > rbw / 2.0 {
            let pn = interp_curve(&nr.f, &nr.total, off.clamp(100.0, 100e6));
            p += lin(carrier_dbm + pn + 10.0 * rbw.log10() + 1.2 * rnd());
        }
        for &(lf_, ld) in &lines {
            let x = (fx - lf_) / sigma;
            if x.abs() < 8.0 {
                p += lin(ld) * (-0.5 * x * x).exp();
            }
        }
        out.f.push(fx);
        out.dbm.push(db(p));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loopfilter::{design, DesignRequest};
    use crate::{plan, regs};

    #[test]
    fn jitter_in_datasheet_ballpark() {
        let mut w = regs::defaults();
        // 2.05 GHz-ish: fPFD 25 MHz, N = 82
        regs::set(&mut w, "INT", 82);
        regs::set(&mut w, "ICP", 7);
        let d = plan::derive(&w, 25e6, 5100.0);
        let lp = LoopParams { icp_a: regs::icp_amps(7, 5100.0), kvco_hz_v: 40e6, n: d.n_loop, f_pfd: d.f_pfd };
        let lf = design(&lp, &DesignRequest { fc_hz: 80e3, alpha: 4.0, beta: 4.0, gamma: 4.0, order: 3, snap: true });
        let rn = default_ref_noise();
        let ctx = NoiseCtx { d: &d, lf: &lf, lp, ref_noise: &rn, dither: false };
        let r = compute(&ctx, &NoiseOptions { f1: 12e3, f2: 20e6, output_b: false });
        assert!(r.jitter_fs > 60.0 && r.jitter_fs < 400.0, "jitter {}", r.jitter_fs);
        let pfd = r.spurs.iter().find(|s| s.kind == "pfd").unwrap();
        assert!(pfd.level_dbc < -60.0, "pfd spur {}", pfd.level_dbc);
    }
}
