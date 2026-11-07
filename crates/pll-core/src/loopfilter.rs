//! Passive charge-pump loop filter: design (datasheet "Loop Filter Calculations"),
//! frequency-domain analysis and a non-linear time-domain lock transient.
//!
//! Topology (2nd order): CP_OUT ─┬─ C1 ─ GND
//!                               └─ R2 ─ C2 ─ GND        (VTUNE = CP node)
//! 3rd order adds:  CP node ─ R3 ─┬─ VTUNE
//!                                └─ C3 ─ GND

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct C64 {
    pub re: f64,
    pub im: f64,
}

impl C64 {
    pub const fn new(re: f64, im: f64) -> Self {
        Self { re, im }
    }
    pub fn add(self, o: C64) -> C64 {
        C64::new(self.re + o.re, self.im + o.im)
    }
    pub fn mul(self, o: C64) -> C64 {
        C64::new(self.re * o.re - self.im * o.im, self.re * o.im + self.im * o.re)
    }
    pub fn scale(self, k: f64) -> C64 {
        C64::new(self.re * k, self.im * k)
    }
    pub fn inv(self) -> C64 {
        let d = self.re * self.re + self.im * self.im;
        C64::new(self.re / d, -self.im / d)
    }
    pub fn div(self, o: C64) -> C64 {
        self.mul(o.inv())
    }
    pub fn abs(self) -> f64 {
        self.re.hypot(self.im)
    }
    pub fn arg(self) -> f64 {
        self.im.atan2(self.re)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LoopFilter {
    /// 2 or 3
    pub order: u8,
    /// Cp (C1), farads
    pub c1: f64,
    /// Cz (C2), farads
    pub c2: f64,
    /// Rz (R2), ohms
    pub r2: f64,
    /// Rp2 (R3), ohms (3rd order)
    pub r3: f64,
    /// Cp2 (C3), farads (3rd order)
    pub c3: f64,
}

impl Default for LoopFilter {
    fn default() -> Self {
        // EVB schematic Rev A, 2015-05-14, sheet 1: C23, C22, R9 (+ R7=0), R6, C24.
        // Timing Commander examples use Rp2=500 Ω; the fitted schematic says 510 Ω.
        LoopFilter { order: 3, c1: 2.7e-9, c2: 47e-9, r2: 360.0, r3: 510.0, c3: 2.2e-9 }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct LoopParams {
    pub icp_a: f64,
    pub kvco_hz_v: f64,
    pub n: f64,
    pub f_pfd: f64,
}

impl LoopFilter {
    /// Transimpedance V_tune / I_cp at angular frequency w.
    pub fn z(&self, w: f64) -> C64 {
        let s = C64::new(0.0, w);
        let zc = |c: f64| s.scale(c).inv();
        let y1 = s.scale(self.c1);
        let y2 = C64::new(self.r2, 0.0).add(zc(self.c2)).inv();
        if self.order >= 3 {
            let br3 = C64::new(self.r3, 0.0).add(zc(self.c3));
            let ya = y1.add(y2).add(br3.inv());
            let za = ya.inv();
            // divider R3 / C3
            za.mul(zc(self.c3)).div(br3)
        } else {
            y1.add(y2).inv()
        }
    }

    pub fn zero_hz(&self) -> f64 {
        1.0 / (2.0 * PI * self.r2 * self.c2)
    }
    pub fn pole1_hz(&self) -> f64 {
        if self.order >= 3 {
            return self.third_order_poles().0;
        }
        let cs = self.c1 * self.c2 / (self.c1 + self.c2);
        1.0 / (2.0 * PI * self.r2 * cs)
    }
    pub fn pole2_hz(&self) -> Option<f64> {
        (self.order >= 3).then(|| self.third_order_poles().1)
    }

    /// Coupled RC poles: vendor LF workbook rev1.0, cells B54:B60.
    /// Z(s) = (1 + s R2 C2) / [s (a0 + s a1 + s² a2)].
    fn third_order_poles(&self) -> (f64, f64) {
        let a0 = self.c1 + self.c2 + self.c3;
        let a1 = self.c2 * self.r2 * (self.c1 + self.c3)
            + self.c3 * self.r3 * (self.c1 + self.c2);
        let a2 = self.c1 * self.c2 * self.c3 * self.r2 * self.r3;
        let root = (a1 * a1 - 4.0 * a0 * a2).max(0.0).sqrt();
        // Rationalized low root avoids cancellation for widely separated poles.
        (2.0 * a0 / (a1 + root) / (2.0 * PI), (a1 + root) / (2.0 * a2) / (2.0 * PI))
    }
}

/// Open-loop gain G(jw) = Icp·Kvco·Z(jw) / (jw·N)  (Kvco in Hz/V, Kpd = Icp/2π)
pub fn open_loop(lf: &LoopFilter, p: &LoopParams, f: f64) -> C64 {
    let w = 2.0 * PI * f;
    let s = C64::new(0.0, w);
    lf.z(w).scale(p.icp_a * p.kvco_hz_v / p.n).div(s)
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct LoopAnalysis {
    pub f: Vec<f64>,
    pub ol_mag_db: Vec<f64>,
    pub ol_phase_deg: Vec<f64>,
    pub cl_mag_db: Vec<f64>,
    pub err_mag_db: Vec<f64>,
    pub fc_hz: f64,
    pub pm_deg: f64,
    pub f3db_hz: f64,
    pub peaking_db: f64,
    pub zero_hz: f64,
    pub pole1_hz: f64,
    pub pole2_hz: Option<f64>,
    pub stable: bool,
}

pub fn logspace(a: f64, b: f64, n: usize) -> Vec<f64> {
    let (la, lb) = (a.log10(), b.log10());
    (0..n).map(|i| 10f64.powf(la + (lb - la) * i as f64 / (n - 1) as f64)).collect()
}

pub fn closed_loop(lf: &LoopFilter, p: &LoopParams, f: f64) -> (C64, C64) {
    let g = open_loop(lf, p, f);
    let one = C64::new(1.0, 0.0);
    let den = one.add(g);
    (g.div(den), one.div(den))
}

pub fn analyze(lf: &LoopFilter, p: &LoopParams) -> LoopAnalysis {
    let f = logspace(10.0, 100e6, 361);
    let mut a = LoopAnalysis { zero_hz: lf.zero_hz(), pole1_hz: lf.pole1_hz(), pole2_hz: lf.pole2_hz(), ..Default::default() };
    let mut prev: Option<(f64, f64, f64)> = None;
    let mut unwrap_off = 0.0;
    let mut last_ph = None::<f64>;
    for &fi in &f {
        let g = open_loop(lf, p, fi);
        let (h, e) = closed_loop(lf, p, fi);
        let mag = 20.0 * g.abs().log10();
        let mut ph = g.arg().to_degrees();
        if let Some(lp) = last_ph {
            while ph + unwrap_off - lp > 180.0 {
                unwrap_off -= 360.0;
            }
            while ph + unwrap_off - lp < -180.0 {
                unwrap_off += 360.0;
            }
        }
        ph += unwrap_off;
        last_ph = Some(ph);
        if let Some((pf, pm, pp)) = prev {
            if pm >= 0.0 && mag < 0.0 && a.fc_hz == 0.0 {
                let t = pm / (pm - mag);
                let lf_ = pf.log10() + t * (fi.log10() - pf.log10());
                a.fc_hz = 10f64.powf(lf_);
                a.pm_deg = 180.0 + (pp + t * (ph - pp));
            }
        }
        prev = Some((fi, mag, ph));
        a.ol_mag_db.push(mag);
        a.ol_phase_deg.push(ph);
        let hdb = 20.0 * h.abs().log10();
        a.cl_mag_db.push(hdb);
        a.err_mag_db.push(20.0 * e.abs().log10());
        a.peaking_db = a.peaking_db.max(hdb);
        if a.f3db_hz == 0.0 && hdb < -3.0 && fi > 100.0 {
            a.f3db_hz = fi;
        }
    }
    a.f = f;
    a.stable = a.pm_deg > 0.0 && a.fc_hz > 0.0;
    a
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct DesignRequest {
    pub fc_hz: f64,
    /// α = fc / fz
    pub alpha: f64,
    /// β = fp / fc
    pub beta: f64,
    /// γ = fp2 / fp (3rd order)
    pub gamma: f64,
    pub order: u8,
    pub snap: bool,
}

const E12: [f64; 12] = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E24: [f64; 24] = [
    1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];

pub fn snap(v: f64, series: &[f64]) -> f64 {
    if v <= 0.0 || !v.is_finite() {
        return v;
    }
    let dec = 10f64.powf(v.log10().floor());
    let m = v / dec;
    let mut best = series[0] * dec;
    let mut be = f64::MAX;
    for &s in series.iter().chain(std::iter::once(&10.0)) {
        let e = (m.log10() - s.log10()).abs();
        if e < be {
            be = e;
            best = s * dec;
        }
    }
    best
}

/// Datasheet procedure: Rz = 2π·fc·N/(Icp·Kvco), Cz = α/(2π·fc·Rz),
/// Cp = Cz/(α·β), Rp2 ≈ 1.5·Rz, Cp2 = 1/(2π·γ·fp·Rp2).
pub fn design(p: &LoopParams, d: &DesignRequest) -> LoopFilter {
    let rz = 2.0 * PI * d.fc_hz * p.n / (p.icp_a * p.kvco_hz_v);
    let cz = d.alpha / (2.0 * PI * d.fc_hz * rz);
    let cp = cz / (d.alpha * d.beta);
    let fp = d.beta * d.fc_hz;
    let rp2 = 1.5 * rz;
    let cp2 = 1.0 / (2.0 * PI * d.gamma * fp * rp2);
    let mut lf = LoopFilter { order: if d.order >= 3 { 3 } else { 2 }, c1: cp, c2: cz, r2: rz, r3: rp2, c3: cp2 };
    if d.snap {
        lf.c1 = snap(lf.c1, &E12);
        lf.c2 = snap(lf.c2, &E12);
        lf.c3 = snap(lf.c3, &E12);
        lf.r2 = snap(lf.r2, &E24);
        lf.r3 = snap(lf.r3, &E24);
    }
    lf
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct TransientRequest {
    /// Initial VCO frequency error (Hz at the VCO) — e.g. residual after band select.
    pub df0_hz: f64,
    /// Output-referred settling tolerance, Hz.
    pub tol_hz: f64,
    pub m0: u32,
    pub ld_window_ns: f64,
    pub ld_cycles: u32,
    /// Fast-lock: Icp×16 and R2/4 for t_fast seconds
    #[serde(default)]
    pub fast_lock_s: f64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Transient {
    pub t_us: Vec<f64>,
    pub f_err_hz: Vec<f64>,
    pub vtune_dev_mv: Vec<f64>,
    pub phase_err_deg: Vec<f64>,
    pub settle_s: Option<f64>,
    pub ld_s: Option<f64>,
    pub cycle_slips: u32,
}

/// Time-domain lock transient with a saturating PFD (±Icp) — captures both the
/// linear settling and the frequency-acquisition (cycle-slip) phase.
pub fn transient(lf: &LoopFilter, p: &LoopParams, q: &TransientRequest) -> Transient {
    let la = analyze(lf, p);
    let fc = if la.fc_hz > 0.0 { la.fc_hz } else { 10e3 };
    // State: va (C1 node), vz (C2), vb (C3 / VTUNE), th (phase error rad)
    let tau_min = {
        let mut t = lf.r2 * lf.c1 * lf.c2 / (lf.c1 + lf.c2);
        if lf.order >= 3 {
            t = t.min(lf.r3 * lf.c3);
        }
        t.max(1e-10)
    };
    let dt = (tau_min / 6.0).min(1.0 / (fc * 400.0));
    let c_tot = lf.c1 + lf.c2 + if lf.order >= 3 { lf.c3 } else { 0.0 };
    let t_slew = q.df0_hz.abs() * c_tot / (p.icp_a * p.kvco_hz_v).max(1e-12);
    let t_end = (30.0 / fc + 3.0 * t_slew).min(0.05);
    let steps = ((t_end / dt) as usize).clamp(1000, 3_000_000);
    let dt = t_end / steps as f64;
    let v0 = q.df0_hz / p.kvco_hz_v;
    let mut st = [v0, v0, v0, 0.0f64];
    let third = lf.order >= 3;
    let kv = p.kvco_hz_v;
    let n = p.n;
    let deriv = |s: &[f64; 4], fast: bool| -> [f64; 4] {
        let (va, vz, vb, th) = (s[0], s[1], s[2], s[3]);
        let x = (th / (2.0 * PI)).clamp(-1.0, 1.0);
        let icp = p.icp_a * if fast { 16.0 } else { 1.0 };
        let i = icp * x;
        let r2 = lf.r2 * if fast { 0.25 } else { 1.0 };
        let iz = (va - vz) / r2;
        let (i3, dvb) = if third {
            let i3 = (va - vb) / lf.r3;
            (i3, i3 / lf.c3)
        } else {
            (0.0, 0.0)
        };
        let dva = (i - iz - i3) / lf.c1;
        let vt = if third { vb } else { va };
        let dth = -2.0 * PI * kv * vt / n;
        [dva, iz / lf.c2, if third { dvb } else { dva }, dth]
    };
    let mut out = Transient::default();
    let decim = (steps / 1500).max(1);
    let tol_vco = q.tol_hz * q.m0.max(1) as f64;
    let mut settled_at: Option<f64> = None;
    let mut ld_since: Option<f64> = None;
    let t_pfd = 1.0 / p.f_pfd.max(1.0);
    let ld_need = q.ld_cycles as f64 * t_pfd;
    let mut ld_at: Option<f64> = None;
    for k in 0..=steps {
        let t = k as f64 * dt;
        let fast = t < q.fast_lock_s;
        let vt = if third { st[2] } else { st[0] };
        let ferr_vco = kv * vt;
        if ferr_vco.abs() <= tol_vco {
            if settled_at.is_none() {
                settled_at = Some(t);
            }
        } else {
            settled_at = None;
        }
        let terr_ns = (st[3] / (2.0 * PI)).abs() * t_pfd * 1e9;
        if terr_ns < q.ld_window_ns {
            let s0 = *ld_since.get_or_insert(t);
            if ld_at.is_none() && t - s0 >= ld_need {
                ld_at = Some(t);
            }
        } else {
            ld_since = None;
            ld_at = None;
        }
        if k % decim == 0 {
            out.t_us.push(t * 1e6);
            out.f_err_hz.push(ferr_vco / q.m0.max(1) as f64);
            out.vtune_dev_mv.push((vt - 0.0) * 1e3);
            out.phase_err_deg.push(st[3].to_degrees());
        }
        // RK4
        let k1 = deriv(&st, fast);
        let s2: [f64; 4] = std::array::from_fn(|i| st[i] + 0.5 * dt * k1[i]);
        let k2 = deriv(&s2, fast);
        let s3: [f64; 4] = std::array::from_fn(|i| st[i] + 0.5 * dt * k2[i]);
        let k3 = deriv(&s3, fast);
        let s4: [f64; 4] = std::array::from_fn(|i| st[i] + dt * k3[i]);
        let k4 = deriv(&s4, fast);
        for i in 0..4 {
            st[i] += dt / 6.0 * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
        }
        // PFD wraps phase beyond ±2π (cycle slip)
        if st[3].abs() > 2.0 * PI {
            st[3] -= 2.0 * PI * st[3].signum();
            out.cycle_slips += 1;
        }
        if !third {
            st[2] = st[0];
        }
    }
    out.settle_s = settled_at;
    out.ld_s = ld_at;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> LoopParams {
        LoopParams { icp_a: 2.5e-3, kvco_hz_v: 40e6, n: 100.0, f_pfd: 25e6 }
    }

    #[test]
    fn design_hits_bandwidth_and_margin() {
        let p = params();
        let lf = design(&p, &DesignRequest { fc_hz: 100e3, alpha: 4.0, beta: 4.0, gamma: 4.0, order: 3, snap: false });
        let a = analyze(&lf, &p);
        assert!((a.fc_hz / 100e3 - 1.0).abs() < 0.35, "fc {}", a.fc_hz);
        assert!(a.pm_deg > 45.0 && a.pm_deg < 75.0, "pm {}", a.pm_deg);
    }

    #[test]
    fn default_filter_is_stable_at_starter_icp() {
        let settings = crate::api::Settings::default();
        let d = crate::plan::derive(&crate::regs::starter(), settings.ref_hz, settings.rcp_ohm);
        let p = LoopParams { icp_a: d.icp_ma * 1e-3, kvco_hz_v: settings.kvco_hz_v, n: d.n_loop, f_pfd: d.f_pfd };
        let a = analyze(&settings.loop_filter, &p);
        assert!(a.stable && a.pm_deg > 35.0, "pm {} fc {}", a.pm_deg, a.fc_hz);
        assert!(a.fc_hz > 20e3 && a.fc_hz < 120e3, "fc {}", a.fc_hz);
    }

    #[test]
    fn poles_match_vendor_workbook() {
        // 8v97051_LF_Calc B42:B51 inputs, B59:B60 cached reference results.
        // Workbook uses 3.14 for π; allow its 0.051% rounding difference.
        let lf = LoopFilter { order: 3, c1: 2.7e-9, c2: 47e-9, r2: 360.0, r3: 500.0, c3: 0.486e-9 };
        assert!((lf.pole1_hz() / 142_593.530_122_606 - 1.0).abs() < 0.0006);
        assert!((lf.pole2_hz().unwrap() / 803_883.431_246_466 - 1.0).abs() < 0.0006);
        // Verify the pole factorization against the independent nodal model z().
        for f in [1e3, 30e3, 150e3, 800e3, 10e6] {
            let s = C64::new(0.0, 2.0 * PI * f);
            let den = s.scale(lf.c1 + lf.c2 + lf.c3)
                .mul(C64::new(1.0, f / lf.pole1_hz()))
                .mul(C64::new(1.0, f / lf.pole2_hz().unwrap()));
            let expected = C64::new(1.0, 2.0 * PI * f * lf.r2 * lf.c2).div(den);
            let actual = lf.z(2.0 * PI * f);
            assert!((actual.re - expected.re).hypot(actual.im - expected.im) / expected.abs() < 1e-12);
        }
    }

    #[test]
    fn transient_settles() {
        let p = params();
        let lf = design(&p, &DesignRequest { fc_hz: 100e3, alpha: 4.0, beta: 4.0, gamma: 4.0, order: 3, snap: true });
        let tr = transient(&lf, &p, &TransientRequest { df0_hz: 2e6, tol_hz: 1e3, m0: 1, ld_window_ns: 10.0, ld_cycles: 40, fast_lock_s: 0.0 });
        let s = tr.settle_s.expect("must settle");
        assert!(s > 1e-6 && s < 500e-6, "settle {}", s);
        assert!(tr.ld_s.is_some());
    }
}
