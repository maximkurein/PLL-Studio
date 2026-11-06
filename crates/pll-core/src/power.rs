//! Supply current / power / junction temperature estimate (Tables 14A–14C, 16).

use crate::plan::Derived;
use crate::regs::{self, Words};
use serde::Serialize;

pub const VDD: f64 = 3.3;
pub const THETA_JA: f64 = 34.34;

#[derive(Serialize, Clone, Debug, Default)]
pub struct PowerEstimate {
    pub domains: Vec<(String, f64)>,
    pub total_ma: f64,
    pub power_mw: f64,
    pub tj_c: f64,
    pub ambient_c: f64,
}

fn out_ma(dbm: f64) -> f64 {
    match dbm as i32 {
        i32::MIN..=-4 => 16.0,
        -3..=-1 => 20.0,
        0..=2 => 24.0,
        3..=5 => 29.0,
        6 => 31.0,
        _ => 33.0,
    }
}

/// Cumulative divider current (Table 14B) relative to ÷1.
fn div_ma(m0: u32) -> f64 {
    let steps = [6.5, 7.0, 1.0, 1.5, 2.0, 2.0];
    let n = m0.trailing_zeros() as usize;
    steps.iter().take(n.min(6)).sum()
}

pub fn estimate(w: &Words, d: &Derived, ce: bool, outputs_live: bool, ambient_c: f64) -> PowerEstimate {
    let g = |n: &str| regs::get(w, n);
    let mut p = PowerEstimate { ambient_c, ..Default::default() };
    if !ce || g("POWER_DOWN") == 1 {
        p.domains = vec![("Power Down".into(), 10.0)];
    } else {
        let vco_on = g("VCO_POWER_DOWN") == 0;
        let mut vdda = 12.0 + div_ma(d.m0);
        if outputs_live && d.out_a_en {
            vdda += out_ma(d.pwr_a_dbm);
            if d.out_b_en {
                vdda += out_ma(d.pwr_b_dbm);
            }
        }
        p.domains = vec![
            ("V_CP".into(), 23.7 + d.icp_ma * 0.1),
            ("VVCO".into(), if vco_on { 30.0 } else { 0.5 }),
            ("VDDD".into(), 0.5),
            ("VDD_SD".into(), 6.0),
            ("VDDA".into(), vdda),
        ];
    }
    p.total_ma = p.domains.iter().map(|x| x.1).sum();
    p.power_mw = p.total_ma * VDD;
    p.tj_c = ambient_c + THETA_JA * p.power_mw / 1000.0;
    p
}
