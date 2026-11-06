//! Behavioural model of the 8V97051 silicon, driven only through its SPI
//! frames and the CE / MUTE pins — exactly like the real chip.
//!
//! Modelled: 32-bit framing & control bits, double buffering (activated by an
//! R0 write), readback through R7 (SPI_R_WN / READBACK_ADDR) only when
//! MUX_OUT = SDO, sticky status bits cleared by writing 1, read-only IDs,
//! three VCO cores with sub-band autocalibration timed by the band-select
//! clock, VTUNE range, temperature drift, loop settling from the real loop
//! filter (non-linear PFD transient), digital lock detect, MTLD and MUTE.

use crate::loopfilter::{self, LoopFilter, LoopParams, TransientRequest};
use crate::plan::{self, Derived};
use crate::regs::{self, Access, Words, FIELDS, NUM_REGS};
use serde::Serialize;
use std::time::Instant;

pub const SUB_BAND_HZ: f64 = 20e6;
pub const VTUNE_MID: f64 = 1.5;
pub const VTUNE_MIN: f64 = 0.5;
pub const VTUNE_MAX: f64 = 2.5;
/// Free-running VCO drift used for the temperature experiment.
pub const DRIFT_HZ_PER_C: f64 = -0.35e6;

#[derive(Clone, Debug)]
pub struct SimEnv {
    pub f_ref: f64,
    pub rcp_ohm: f64,
    pub kvco_hz_v: f64,
    pub lf: LoopFilter,
    pub lock_tol_hz: f64,
}

#[derive(Clone, Debug)]
struct Calibration {
    t0: Instant,
    /// VCO frequency at VTUNE = 1.5 V in the selected sub-band.
    band_center: f64,
    core: u8,
    cal_temp: f64,
    bs_time_s: f64,
    /// Time from end of band select to LD assertion (None = never locks).
    ld_time_s: Option<f64>,
    settle_s: Option<f64>,
    f_target_vco: f64,
    /// VCO frequency right after band select (start of analog settling).
    #[allow(dead_code)]
    f_start_vco: f64,
    tr_t_us: Vec<f64>,
    tr_f: Vec<f64>,
    fail: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SimStatus {
    pub state: &'static str,
    pub reason: Option<String>,
    pub locked: bool,
    pub ld_pin: bool,
    pub mux_level: Option<bool>,
    pub vtune: f64,
    pub vco_core: u8,
    pub sub_band: i64,
    pub f_vco_now: f64,
    pub f_out_now: f64,
    pub since_write_us: f64,
    pub band_select_us: f64,
    pub lock_time_us: Option<f64>,
    pub settle_us: Option<f64>,
    pub outputs_live: bool,
    pub temp_c: f64,
    pub cal_temp_c: f64,
    pub band_sel_done: bool,
    pub loss_dig_lock: bool,
    pub loss_anlg_lock: bool,
    pub spi_error: bool,
    pub ce: bool,
    pub mute_pin_low: bool,
}

pub struct VirtualChip {
    written: Words,
    active: Words,
    pending_read: Option<usize>,
    loss_dig: bool,
    loss_anlg: bool,
    spi_err: bool,
    ce: bool,
    mute_low: bool,
    temp_c: f64,
    cal: Option<Calibration>,
    was_locked: bool,
    env: SimEnv,
    /// Frequency the VCO was running at before the latest R0 write.
    last_f_vco: f64,
    last_vtune: f64,
}

impl VirtualChip {
    pub fn new(env: SimEnv) -> Self {
        let d = regs::defaults();
        let mut c = VirtualChip {
            written: d,
            active: d,
            pending_read: None,
            loss_dig: false,
            loss_anlg: false,
            spi_err: false,
            ce: true,
            mute_low: false,
            temp_c: 25.0,
            cal: None,
            was_locked: false,
            env,
            last_f_vco: 0.0,
            last_vtune: VTUNE_MID,
        };
        c.calibrate(true);
        c
    }

    pub fn set_env(&mut self, env: SimEnv) {
        let changed = env.lf != self.env.lf
            || env.kvco_hz_v != self.env.kvco_hz_v
            || env.f_ref != self.env.f_ref
            || env.rcp_ohm != self.env.rcp_ohm;
        self.env = env;
        if changed {
            // Reference / loop change: behave as if R0 was rewritten.
            self.calibrate(true);
        }
    }

    pub fn set_temperature(&mut self, t: f64) {
        self.temp_c = t.clamp(-60.0, 150.0);
        self.update_sticky();
    }

    pub fn temperature(&self) -> f64 {
        self.temp_c
    }

    pub fn inject_spi_error(&mut self) {
        self.spi_err = true;
    }

    pub fn set_ce(&mut self, high: bool) {
        if self.ce != high {
            self.ce = high;
            if high {
                // power-up: band select
                self.calibrate(true);
            }
            self.update_sticky();
        }
    }

    pub fn set_mute_pin(&mut self, low: bool) {
        self.mute_low = low;
    }

    fn derived(&self) -> Derived {
        plan::derive(&self.active, self.env.f_ref, self.env.rcp_ohm)
    }

    /// Full-duplex 32-bit SPI frame: returns what the chip drives on MUX_OUT
    /// while the frame is shifted in.
    pub fn transfer(&mut self, word: u32) -> u32 {
        let miso = self.miso_for_frame();
        self.write(word);
        miso
    }

    fn miso_for_frame(&mut self) -> u32 {
        let mux = regs::get(&self.active, "MUX_OUT");
        let read = self.pending_read.take();
        match mux {
            7 => match read {
                Some(addr) => self.read_word(addr),
                None => 0,
            },
            1 => u32::MAX,
            2 => 0,
            6 => {
                if self.status().ld_pin_internal() {
                    u32::MAX
                } else {
                    0
                }
            }
            3 | 4 => 0xCCCC_CCCC, // divider pulses sampled at SCLK rate
            _ => 0xFFFF_FFFF,     // Hi-Z, pulled up by the bridge
        }
    }

    pub fn read_word(&self, addr: usize) -> u32 {
        let mut w = self.written[addr];
        match addr {
            6 => {
                let st = self.status();
                w &= !(0b11 << 30);
                w |= (st.locked as u32) << 31;
                w |= (st.band_sel_done as u32) << 30;
            }
            7 => {
                w &= !(0b111 << 29) & !(0x7F << 21) & !(1 << 3);
                w |= (self.loss_dig as u32) << 31 | (self.loss_anlg as u32) << 30 | (self.spi_err as u32) << 29;
                w |= 1 << 25 | 6 << 21; // REV_ID = 001, DEV_ID = 0110
            }
            _ => {}
        }
        w
    }

    fn write(&mut self, word: u32) {
        let reg = (word & 7) as usize;
        match reg {
            7 => {
                // sticky clear on 1
                if word & (1 << 31) != 0 {
                    self.loss_dig = false;
                }
                if word & (1 << 30) != 0 {
                    self.loss_anlg = false;
                }
                if word & (1 << 29) != 0 {
                    self.spi_err = false;
                }
                let keep = word & !(0b111 << 29) & !(0x7F << 21);
                if keep & (1 << 3) != 0 {
                    self.pending_read = Some(((keep >> 4) & 7) as usize);
                }
                let stored = keep & !(1 << 3); // SPI_R_WN self-clears
                self.written[7] = stored;
                self.active[7] = stored;
            }
            _ => {
                let ro_mask = FIELDS
                    .iter()
                    .filter(|f| f.reg == reg && f.access == Access::Ro)
                    .fold(0u32, |m, f| m | f.mask());
                let w = word & !ro_mask;
                self.written[reg] = w;
                let db_rf_div = regs::get(&self.active, "DOUBLE_BUFFER") == 1;
                for f in FIELDS.iter().filter(|f| f.reg == reg) {
                    let buffered = f.double_buffered || (f.name == "RF_DIV" && db_rf_div);
                    if !buffered {
                        f.set(&mut self.active, f.get(&self.written));
                    }
                }
                self.active[reg] = (self.active[reg] & !7) | reg as u32;
                if reg == 0 {
                    // R0 write latches all double-buffered values
                    for f in FIELDS.iter().filter(|f| f.double_buffered || f.name == "RF_DIV") {
                        f.set(&mut self.active, f.get(&self.written));
                    }
                    let bsd = regs::get(&self.active, "BAND_SEL_DISABLE") == 1;
                    self.calibrate(!bsd);
                }
            }
        }
        self.update_sticky();
    }

    /// (Re)start band selection (if `band_select`) and the analog settling.
    fn calibrate(&mut self, band_select: bool) {
        let st_before = self.status();
        if st_before.locked || st_before.state == "settling" {
            self.last_f_vco = st_before.f_vco_now;
            self.last_vtune = st_before.vtune;
        }
        let d = self.derived();
        let now = Instant::now();
        let kv = self.env.kvco_hz_v;
        let mut fail = None;
        let target = d.f_vco;
        let (band_center, core, cal_temp, bs_time) = if band_select || self.cal.is_none() {
            let bs_max = if regs::get(&self.active, "BAND_SEL_CLK_MODE") == 1 { 500e3 } else { 125e3 };
            let acc = [1.0, 2.0, 4.0, 4.0][regs::get(&self.active, "BAND_SEL_ACC") as usize];
            let steps = 12.0; // 2 core decisions + ~10 sub-band binary search steps
            let fbs = d.f_band_sel.max(1.0);
            let bs_time = steps * acc * 2.0 / fbs;
            let mut center = (target / SUB_BAND_HZ).round() * SUB_BAND_HZ + 3.1e6;
            if fbs > bs_max * 1.05 {
                // logic clocked too fast: comparator decisions are wrong
                let over = fbs / bs_max;
                center += SUB_BAND_HZ * (2.0 + over.log2() * 4.0) * if target as u64 % 2 == 0 { 1.0 } else { -1.0 };
                fail = Some(format!(
                    "Такт выбора диапазона {:.0} кГц превышает {:.0} кГц — калибровка ошибочна",
                    fbs / 1e3,
                    bs_max / 1e3
                ));
            }
            if band_select {
                self.loss_anlg = true;
            }
            (center, plan::vco_core(target), self.temp_c, bs_time)
        } else {
            let c = self.cal.as_ref().unwrap();
            (c.band_center, c.core, c.cal_temp, 0.0)
        };
        // initial VCO frequency at start of settling
        let f_start = if band_select {
            band_center + DRIFT_HZ_PER_C * (self.temp_c - cal_temp)
        } else if self.last_f_vco > 0.0 {
            self.last_f_vco
        } else {
            target
        };
        let mut cal = Calibration {
            t0: now,
            band_center,
            core,
            cal_temp,
            bs_time_s: bs_time,
            ld_time_s: None,
            settle_s: None,
            f_target_vco: target,
            f_start_vco: f_start,
            tr_t_us: vec![],
            tr_f: vec![],
            fail,
        };
        if let Some(reason) = self.blocking_reason(&d) {
            cal.fail.get_or_insert(reason);
        }
        if cal.fail.is_none() {
            let icp = regs::icp_amps(regs::get(&self.active, "ICP"), self.env.rcp_ohm);
            let lp = LoopParams { icp_a: icp, kvco_hz_v: kv, n: d.n_loop.max(1.0), f_pfd: d.f_pfd };
            let fast = if regs::get(&self.active, "CLK_DIV_MODE") == 1 {
                d.t_sync_s
            } else {
                0.0
            };
            let tr = loopfilter::transient(
                &self.env.lf,
                &lp,
                &TransientRequest {
                    df0_hz: f_start - target,
                    tol_hz: self.env.lock_tol_hz,
                    m0: 1,
                    ld_window_ns: d.ld_window_ns,
                    ld_cycles: d.ld_cycles,
                    fast_lock_s: fast,
                },
            );
            cal.ld_time_s = tr.ld_s;
            cal.settle_s = tr.settle_s;
            cal.tr_t_us = tr.t_us;
            cal.tr_f = tr.f_err_hz;
            if tr.ld_s.is_none() {
                cal.fail = Some("Петля не захватывается: проверьте петлевой фильтр и ICP (запас по фазе)".into());
            }
        }
        self.cal = Some(cal);
    }

    fn blocking_reason(&self, d: &Derived) -> Option<String> {
        let g = |n: &str| regs::get(&self.active, n);
        if !self.ce {
            return Some("CE = 0: кристалл выключен".into());
        }
        if g("POWER_DOWN") == 1 {
            return Some("Программный Power Down".into());
        }
        if g("VCO_POWER_DOWN") == 1 {
            return Some("ГУН выключен".into());
        }
        if g("CP_HIGHZ") == 1 {
            return Some("Charge pump в Hi-Z — петля разомкнута, частота дрейфует".into());
        }
        if g("PD_POLARITY") == 0 {
            return Some("Неверная полярность PFD — положительная обратная связь, VTUNE уходит на край".into());
        }
        if d.r == 0 || d.f_pfd <= 0.0 {
            return Some("R = 0".into());
        }
        if d.int < plan::INT_MIN {
            return Some("INT < 8".into());
        }
        if !d.integer_mode && d.f_pfd > plan::PFD_MAX_FRAC {
            return Some("fPFD > 125 МГц в дробном режиме — ΣΔ не успевает".into());
        }
        if d.f_pfd > plan::PFD_MAX_INT {
            return Some("fPFD > 310 МГц".into());
        }
        if !d.integer_mode && d.frac >= d.modulus {
            return Some("FRAC ≥ MOD".into());
        }
        if d.f_vco < plan::VCO_MIN - 30e6 || d.f_vco > plan::VCO_MAX + 30e6 {
            return Some(format!("fVCO {:.1} МГц недостижима для ГУН", d.f_vco / 1e6));
        }
        if d.f_ref < 4e6 || d.f_ref > 320e6 {
            return Some("Нет опорного сигнала / частота вне диапазона".into());
        }
        None
    }

    fn update_sticky(&mut self) {
        let st = self.status();
        if self.was_locked && !st.locked {
            self.loss_dig = true;
        }
        self.was_locked = st.locked;
    }

    /// Status + sticky-bit bookkeeping (call periodically).
    pub fn poll(&mut self) -> SimStatus {
        self.update_sticky();
        self.status()
    }

    pub fn status(&self) -> SimStatus {
        let d = self.derived();
        let mut s = SimStatus {
            temp_c: self.temp_c,
            ce: self.ce,
            mute_pin_low: self.mute_low,
            loss_dig_lock: self.loss_dig,
            loss_anlg_lock: self.loss_anlg,
            spi_error: self.spi_err,
            ..Default::default()
        };
        let Some(cal) = &self.cal else {
            s.state = "unlocked";
            return s;
        };
        let kv = self.env.kvco_hz_v;
        let t = cal.t0.elapsed().as_secs_f64();
        s.since_write_us = t * 1e6;
        s.band_select_us = cal.bs_time_s * 1e6;
        s.cal_temp_c = cal.cal_temp;
        s.vco_core = cal.core;
        s.sub_band = (cal.band_center / SUB_BAND_HZ).floor() as i64;
        s.band_sel_done = t >= cal.bs_time_s;
        s.lock_time_us = cal.ld_time_s.map(|x| (x + cal.bs_time_s) * 1e6);
        s.settle_us = cal.settle_s.map(|x| (x + cal.bs_time_s) * 1e6);
        let drift = DRIFT_HZ_PER_C * (self.temp_c - cal.cal_temp);
        let center_now = cal.band_center + drift;
        let vt_needed = VTUNE_MID + (cal.f_target_vco - center_now) / kv;

        if !self.ce || regs::get(&self.active, "POWER_DOWN") == 1 {
            s.state = "power_down";
            s.reason = Some(if !self.ce { "CE = 0" } else { "POWER_DOWN = 1" }.into());
            s.vtune = 0.0;
            return s;
        }
        if let Some(f) = &cal.fail {
            s.state = "unlocked";
            s.reason = Some(f.clone());
            let rail = if vt_needed >= VTUNE_MID { VTUNE_MAX + 0.4 } else { 0.1 };
            s.vtune = rail;
            s.f_vco_now = center_now + (rail - VTUNE_MID) * kv;
        } else if !s.band_sel_done {
            s.state = "calibrating";
            s.vtune = VTUNE_MID;
            s.f_vco_now = cal.band_center + drift;
        } else if !(VTUNE_MIN..=VTUNE_MAX).contains(&vt_needed) {
            s.state = "unlocked";
            s.reason = Some(format!(
                "VTUNE = {:.2} В вне 0.5…2.5 В — {}",
                vt_needed,
                if regs::get(&self.active, "BAND_SEL_DISABLE") == 1 {
                    "выбор диапазона отключён, перестройка слишком велика"
                } else {
                    "дрейф температуры с момента калибровки, перезапишите R0"
                }
            ));
            s.vtune = vt_needed.clamp(0.1, 2.9);
            s.f_vco_now = center_now + (s.vtune - VTUNE_MID) * kv;
        } else {
            let ts = t - cal.bs_time_s;
            // f error from the precomputed transient
            let ferr = interp_tr(&cal.tr_t_us, &cal.tr_f, ts * 1e6);
            s.f_vco_now = cal.f_target_vco + ferr;
            s.vtune = vt_needed + ferr / kv;
            s.locked = cal.ld_time_s.map(|x| ts >= x).unwrap_or(false);
            s.state = if s.locked { "locked" } else { "settling" };
        }
        let mtld = regs::get(&self.active, "MTLD") == 1;
        s.outputs_live = d.out_a_en && !self.mute_low && !(mtld && !s.locked);
        s.f_out_now = s.f_vco_now / d.m0 as f64;
        s.ld_pin = match regs::get(&self.active, "LD_PIN_MODE") {
            1 => s.locked,
            3 => true,
            _ => false,
        };
        s.mux_level = match regs::get(&self.active, "MUX_OUT") {
            1 => Some(true),
            2 => Some(false),
            6 => Some(s.locked),
            _ => None,
        };
        s
    }

    pub fn active_words(&self) -> Words {
        self.active
    }
    pub fn written_words(&self) -> Words {
        self.written
    }
    pub fn pending_double_buffer(&self) -> Vec<&'static str> {
        FIELDS
            .iter()
            .filter(|f| f.reg < NUM_REGS && f.get(&self.written) != f.get(&self.active) && f.access == Access::Rw)
            .map(|f| f.name)
            .collect()
    }
}

impl SimStatus {
    fn ld_pin_internal(&self) -> bool {
        self.locked
    }
}

fn interp_tr(t: &[f64], y: &[f64], x: f64) -> f64 {
    if t.is_empty() {
        return 0.0;
    }
    if x <= t[0] {
        return y[0];
    }
    if x >= *t.last().unwrap() {
        return *y.last().unwrap();
    }
    let i = t.partition_point(|v| *v < x).max(1);
    let (t0, t1) = (t[i - 1], t[i]);
    let k = (x - t0) / (t1 - t0).max(1e-12);
    y[i - 1] + k * (y[i] - y[i - 1])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> SimEnv {
        SimEnv { f_ref: 25e6, rcp_ohm: 5100.0, kvco_hz_v: 40e6, lf: LoopFilter::default(), lock_tol_hz: 1e3 }
    }

    fn boot() -> VirtualChip {
        let mut c = VirtualChip::new(env());
        let w = regs::starter();
        for r in (0..NUM_REGS).rev() {
            c.transfer(regs::sanitize(r, w[r]));
        }
        c
    }

    fn wait_lock(c: &VirtualChip) -> SimStatus {
        for _ in 0..200 {
            let s = c.status();
            if s.state != "calibrating" && s.state != "settling" {
                return s;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        c.status()
    }

    #[test]
    fn power_on_defaults_violate_band_select_clock() {
        let c = VirtualChip::new(env());
        let s = wait_lock(&c);
        assert_eq!(s.state, "unlocked");
    }

    #[test]
    fn locks_with_starter() {
        let c = boot();
        let s = wait_lock(&c);
        assert_eq!(s.state, "locked", "{:?}", s.reason);
        assert!((s.f_vco_now - 2500e6).abs() < 10e3);
    }

    #[test]
    fn readback_requires_sdo_and_returns_ids() {
        let mut c = VirtualChip::new(env());
        let r7_read = regs::defaults()[7] | 1 << 3 | 7 << 4;
        c.transfer(r7_read);
        let miso = c.transfer(regs::defaults()[7]);
        assert_eq!(miso, 0xFFFF_FFFF, "Hi-Z without SDO");
        let mut r2 = regs::defaults()[2];
        r2 |= 7 << 26;
        c.transfer(r2);
        // MUX_OUT is not double-buffered → active immediately
        c.transfer(r2);
        c.transfer(r7_read);
        let miso = c.transfer(regs::defaults()[7]);
        assert_eq!((miso >> 21) & 0xF, 6);
        assert_eq!((miso >> 25) & 7, 1);
    }

    #[test]
    fn double_buffer_needs_r0() {
        let mut c = VirtualChip::new(env());
        let mut w = regs::defaults();
        regs::set(&mut w, "R_COUNTER", 2);
        c.transfer(w[2]);
        assert_eq!(regs::get(&c.active_words(), "R_COUNTER"), 1);
        c.transfer(w[0]);
        assert_eq!(regs::get(&c.active_words(), "R_COUNTER"), 2);
    }

    #[test]
    fn band_sel_disable_large_jump_unlocks() {
        let mut c = boot();
        wait_lock(&c);
        let mut w = regs::starter();
        regs::set(&mut w, "BAND_SEL_DISABLE", 1);
        c.transfer(w[1]);
        regs::set(&mut w, "INT", 110); // +250 MHz
        c.transfer(w[0]);
        let s = wait_lock(&c);
        assert_eq!(s.state, "unlocked");
        assert!(c.status().loss_dig_lock);
    }
}
