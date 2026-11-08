//! Engine: single owner of the configuration, the hardware link and the
//! SPI transaction log. Both the Tauri app and the HTTP server expose it
//! through one JSON RPC: `handle(cmd, args) -> json`.

use crate::loopfilter::{self, DesignRequest, LoopFilter, LoopParams, TransientRequest};
use crate::noise::{self, NoiseCtx, NoiseOptions, SpectrumRequest};
use crate::plan::{self, Derived, PlanRequest};
use crate::power;
use crate::regs::{self, Words, FIELDS, NUM_REGS};
use crate::sim::{SimEnv, VirtualChip};
use crate::transport::{self, Link, SerialBridge};
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::time::Instant;

const LOG_CAP: usize = 4000;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub ref_hz: f64,
    /// "tcxo" (onboard 25 MHz) | "sma" (J1)
    pub ref_source: String,
    pub rcp_ohm: f64,
    pub kvco_hz_v: f64,
    pub loop_filter: LoopFilter,
    pub ref_noise: Vec<(f64, f64)>,
    pub ambient_c: f64,
    pub lock_tol_hz: f64,
    pub jitter_f1: f64,
    pub jitter_f2: f64,
    /// Residual VCO error after band select used by the lock-time view.
    pub residual_hz: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            ref_hz: 25e6,
            ref_source: "tcxo".into(),
            // EVB schematic Rev A (2015-05-14), sheet 1, R5.
            rcp_ohm: 4700.0,
            kvco_hz_v: plan::KVCO_TYP,
            loop_filter: LoopFilter::default(),
            ref_noise: noise::default_ref_noise(),
            ambient_c: 25.0,
            lock_tol_hz: 1e3,
            jitter_f1: 12e3,
            jitter_f2: 20e6,
            residual_hz: 5e6,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct Txn {
    pub id: u64,
    pub t_ms: f64,
    pub op: &'static str,
    pub reg: Option<u8>,
    pub mosi: Option<u32>,
    pub miso: Option<u32>,
    pub changes: Vec<(String, u32, u32)>,
    pub note: String,
    pub ok: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Persist {
    settings: Settings,
    regs: Vec<u32>,
    auto_apply: bool,
}

pub struct Engine {
    regs: Words,
    dev_regs: Option<Words>,
    settings: Settings,
    link: Box<dyn Link>,
    auto_apply: bool,
    ce: bool,
    muted: bool,
    log: VecDeque<Txn>,
    next_id: u64,
    t0: Instant,
    cfg_path: Option<PathBuf>,
    readback: Option<(Words, [bool; NUM_REGS], [bool; NUM_REGS])>,
    link_error: Option<String>,
}

fn arg<T: for<'de> Deserialize<'de>>(v: &Value, key: &str) -> Result<T> {
    serde_json::from_value(v.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| Error::Invalid(format!("параметр '{}': {}", key, e)))
}

fn opt<T: for<'de> Deserialize<'de>>(v: &Value, key: &str) -> Option<T> {
    v.get(key).and_then(|x| serde_json::from_value(x.clone()).ok())
}

impl Engine {
    pub fn new(cfg_path: Option<PathBuf>) -> Self {
        let mut p = Persist { auto_apply: true, ..Default::default() };
        if let Some(path) = &cfg_path {
            if let Ok(txt) = std::fs::read_to_string(path) {
                if let Ok(x) = serde_json::from_str::<Persist>(&txt) {
                    p = x;
                }
            }
        }
        let mut regs = regs::starter();
        if p.regs.len() == NUM_REGS {
            for (i, w) in p.regs.iter().enumerate() {
                regs[i] = regs::sanitize(i, *w);
            }
        }
        let settings = p.settings;
        let sim = VirtualChip::new(Self::env_of(&settings));
        let mut e = Engine {
            regs,
            dev_regs: Some(Self::defaults_written()),
            settings,
            link: Box::new(sim),
            auto_apply: p.auto_apply,
            ce: true,
            muted: false,
            log: VecDeque::new(),
            next_id: 1,
            t0: Instant::now(),
            cfg_path,
            readback: None,
            link_error: None,
        };
        e.note(&format!("{}: подключён виртуальный 8V97051 (симулятор)", crate::about::title()));
        if e.auto_apply {
            let _ = e.apply();
        }
        e
    }

    fn defaults_written() -> Words {
        let d = regs::defaults();
        std::array::from_fn(|r| regs::sanitize(r, d[r]))
    }

    fn env_of(s: &Settings) -> SimEnv {
        SimEnv {
            f_ref: s.ref_hz,
            rcp_ohm: s.rcp_ohm,
            kvco_hz_v: s.kvco_hz_v,
            lf: s.loop_filter.clone(),
            lock_tol_hz: s.lock_tol_hz,
        }
    }

    fn push_env(&mut self) {
        let env = Self::env_of(&self.settings);
        if let Some(sim) = self.link.as_sim() {
            sim.set_env(env);
        }
    }

    fn persist(&self) {
        if let Some(path) = &self.cfg_path {
            let p = Persist { settings: self.settings.clone(), regs: self.regs.to_vec(), auto_apply: self.auto_apply };
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(path, serde_json::to_string_pretty(&p).unwrap_or_default());
        }
    }

    // ───────────── log ─────────────

    fn push_log(&mut self, mut t: Txn) {
        t.id = self.next_id;
        self.next_id += 1;
        t.t_ms = self.t0.elapsed().as_secs_f64() * 1e3;
        self.log.push_back(t);
        while self.log.len() > LOG_CAP {
            self.log.pop_front();
        }
    }

    fn note(&mut self, msg: impl Into<String>) {
        self.push_log(Txn {
            id: 0,
            t_ms: 0.0,
            op: "note",
            reg: None,
            mosi: None,
            miso: None,
            changes: vec![],
            note: msg.into(),
            ok: true,
        });
    }

    /// One SPI frame with logging.
    fn xfer(&mut self, word: u32, op: &'static str, note: &str) -> Result<u32> {
        let reg = (word & 7) as usize;
        let mut changes = vec![];
        if op == "write" {
            let prev = self.dev_regs.map(|d| d[reg]).unwrap_or_else(|| Self::defaults_written()[reg]);
            let mut a = [0u32; NUM_REGS];
            let mut b = [0u32; NUM_REGS];
            a[reg] = prev;
            b[reg] = word;
            for f in FIELDS.iter().filter(|f| f.reg == reg) {
                let (o, n) = (f.get(&a), f.get(&b));
                if o != n || self.dev_regs.is_none() {
                    changes.push((f.name.to_string(), o, n));
                }
            }
        }
        let res = self.link.transfer(word);
        let (ok, miso) = match &res {
            Ok(m) => (true, Some(*m)),
            Err(e) => {
                self.link_error = Some(e.to_string());
                self.dev_regs = None;
                self.readback = None;
                (false, None)
            }
        };
        self.push_log(Txn {
            id: 0,
            t_ms: 0.0,
            op,
            reg: Some(reg as u8),
            mosi: Some(word),
            miso,
            changes,
            note: if ok { note.to_string() } else { format!("{} — ОШИБКА: {}", note, res.as_ref().err().unwrap()) },
            ok,
        });
        if ok {
            self.link_error = None;
        }
        res
    }

    fn config_word(&self, r: usize) -> u32 {
        let mut w = regs::sanitize(r, self.regs[r]);
        if r == 7 {
            w &= !(1 << 3);
        }
        w
    }

    fn write_reg(&mut self, r: usize, note: &str) -> Result<()> {
        let w = self.config_word(r);
        self.xfer(w, "write", note)?;
        if let Some(d) = self.dev_regs.as_mut() {
            d[r] = w;
        }
        Ok(())
    }

    pub fn write_all(&mut self) -> Result<Vec<usize>> {
        // A partial write must not turn unknown hardware state into assumed defaults.
        self.dev_regs = None;
        let mut v = vec![];
        for r in (0..NUM_REGS).rev() {
            let note = if r == 0 { "R0 последним: применение буферов и калибровка ГУН" } else { "полная запись R7→R0" };
            self.write_reg(r, note)?;
            v.push(r);
        }
        self.dev_regs = Some(std::array::from_fn(|r| self.config_word(r)));
        Ok(v)
    }

    pub fn apply(&mut self) -> Result<Vec<usize>> {
        let Some(dev) = self.dev_regs else {
            return self.write_all();
        };
        let desired: Words = std::array::from_fn(|r| self.config_word(r));
        let changed: Vec<usize> = (0..NUM_REGS).filter(|&r| desired[r] != dev[r]).collect();
        if changed.is_empty() {
            return Ok(vec![]);
        }
        let db_changed = FIELDS.iter().any(|f| f.double_buffered && f.get(&desired) != f.get(&dev));
        let db_rf = regs::get(&desired, "DOUBLE_BUFFER") == 1 && regs::get(&desired, "RF_DIV") != regs::get(&dev, "RF_DIV");
        let need_r0 = changed.contains(&0) || changed.contains(&6) || db_changed || db_rf;
        let mut written = vec![];
        for r in (1..NUM_REGS).rev() {
            if changed.contains(&r) {
                self.write_reg(r, "изменение конфигурации")?;
                written.push(r);
            }
        }
        if need_r0 {
            let why = if changed.contains(&0) {
                "новое N — калибровка ГУН"
            } else {
                "R0 для применения двойных буферов / R6"
            };
            self.write_reg(0, why)?;
            written.push(0);
        }
        Ok(written)
    }

    fn after_change(&mut self) -> Result<()> {
        self.persist();
        if self.auto_apply {
            self.apply()?;
        }
        Ok(())
    }

    // ───────────── readback ─────────────

    pub fn read_register(&mut self, r: usize) -> Result<u32> {
        if !self.link.info().caps.readback {
            return Err(Error::Invalid("Транспорт не поддерживает чтение регистров".into()));
        }
        if self.link.info().kind == "evb_usb" && self.dev_regs.is_none() {
            return Err(Error::Invalid("Сначала запишите полную конфигурацию кнопкой «Записать»: для чтения нужно знать R2 и безопасно переключить MUX_OUT в SDO".into()));
        }
        if self.link.info().kind == "evb_usb" && self.dev_regs.is_some_and(|d| regs::get(&d, "SCLKE") != 1) {
            return Err(Error::Invalid("Для чтения через штатный USB (SPI mode 0) задайте SCLKE = 1 и запишите R7".into()));
        }
        let dev = self.dev_regs.unwrap_or_else(Self::defaults_written);
        let mux = regs::get(&dev, "MUX_OUT");
        let r2_orig = dev[2];
        if mux != 7 {
            let mut w = [0u32; NUM_REGS];
            w[2] = r2_orig;
            regs::set(&mut w, "MUX_OUT", 7);
            self.xfer(w[2], "write", "временно MUX_OUT = SDO для чтения")?;
        }
        let r7 = self.config_word(7);
        let req = (r7 & !(0b111 << 4)) | (1 << 3) | ((r as u32) << 4);
        self.xfer(req, "write", &format!("R7: SPI_R_WN = 1, READBACK_ADDR = {}", r))?;
        let miso = self.xfer(r7, "read", &format!("чтение R{} (кадр записи R7 с SPI_R_WN = 0)", r))?;
        if mux != 7 {
            self.xfer(r2_orig, "write", "восстановление MUX_OUT")?;
        }
        if self.link.info().kind == "evb_usb" && r == 7 && (miso == 0 || miso == u32::MAX) {
            self.readback = None;
            return Err(Error::Link("Нет достоверного SDO от синтезатора: R7 вернулся сплошными 0/1. На схеме EVB Rev A R2 в цепи MUX_OUT → MISO помечен NP; проверьте его монтаж и питание синтезатора. ACK моста не подтверждает запись PLL.".into()));
        }
        let (mut words, mut valid, mut matches) = self.readback.unwrap_or(([0; NUM_REGS], [false; NUM_REGS], [false; NUM_REGS]));
        words[r] = miso;
        valid[r] = true;
        let mut cmp_mask = regs::defined_mask(r) & !regs::status_mask(r);
        if r == 7 {
            cmp_mask &= !(0b1111 << 3); // READBACK_ADDR / SPI_R_WN belong to the read request
        }
        if r == 2 && mux != 7 {
            cmp_mask &= !(0b111 << 26); // MUX_OUT was switched to SDO for the read
        }
        matches[r] = (miso & cmp_mask) == (dev[r] & cmp_mask);
        self.readback = Some((words, valid, matches));
        Ok(miso)
    }

    pub fn clear_sticky(&mut self) -> Result<()> {
        let w = self.config_word(7) | (0b111 << 29);
        self.xfer(w, "write", "сброс sticky-битов (запись 1)")?;
        Ok(())
    }

    // ───────────── derived data ─────────────

    pub fn derived(&self) -> Derived {
        plan::derive(&self.regs, self.settings.ref_hz, self.settings.rcp_ohm)
    }

    fn loop_params(&self, d: &Derived) -> LoopParams {
        LoopParams {
            icp_a: regs::icp_amps(regs::get(&self.regs, "ICP"), self.settings.rcp_ohm),
            kvco_hz_v: self.settings.kvco_hz_v,
            n: d.n_loop.max(1.0),
            f_pfd: d.f_pfd.max(1.0),
        }
    }

    fn sim_status(&mut self) -> Option<crate::sim::SimStatus> {
        self.link.as_sim().map(|s| s.poll())
    }

    fn snapshot(&mut self) -> Value {
        let d = self.derived();
        let st = self.sim_status();
        let live = st.as_ref().map(|s| s.outputs_live).unwrap_or(!self.muted);
        let pw = power::estimate(&self.regs, &d, self.ce, live, self.settings.ambient_c);
        let desired: Words = std::array::from_fn(|r| self.config_word(r));
        let dirty: Vec<bool> = (0..NUM_REGS).map(|r| self.dev_regs.map(|dv| dv[r] != desired[r]).unwrap_or(true)).collect();
        let pending = self.link.as_sim().map(|s| s.pending_double_buffer()).unwrap_or_default();
        let lp = self.loop_params(&d);
        let la = loopfilter::analyze(&self.settings.loop_filter, &lp);
        json!({
            "regs": self.regs,
            "desired": desired,
            "dev_regs": self.dev_regs,
            "dirty": dirty,
            "fields": regs::decode(&self.regs),
            "derived": d,
            "settings": self.settings,
            "link": self.link.info(),
            "link_error": self.link_error,
            "auto_apply": self.auto_apply,
            "pins": { "ce": self.ce, "muted": self.muted },
            "power": pw,
            "log_head": self.next_id - 1,
            "readback": self.readback.map(|(w, v, m)| {
                let fields: BTreeMap<_, _> = FIELDS.iter().filter(|f| v[f.reg])
                    .map(|f| (f.name, f.get(&w))).collect();
                json!({"words": w, "valid": v, "matches": m, "fields": fields})
            }),
            "pending_db": pending,
            "loop": { "fc_hz": la.fc_hz, "pm_deg": la.pm_deg, "stable": la.stable },
            "sim": st,
        })
    }

    fn status(&mut self) -> Value {
        let sim = self.sim_status();
        let ld = if sim.is_some() {
            sim.as_ref().map(|s| s.ld_pin)
        } else {
            match self.link.read_ld() {
                Ok(v) => v,
                Err(e) => {
                    self.link_error = Some(e.to_string());
                    None
                }
            }
        };
        json!({ "sim": sim, "ld": ld, "log_head": self.next_id - 1, "link_error": self.link_error })
    }

    fn export_text(&self) -> String {
        let d = self.derived();
        let mut s = String::new();
        s.push_str("# PLL Studio — конфигурация 8V97051\n");
        s.push_str(&format!(
            "# REF_IN = {:.6} МГц, fPFD = {:.6} МГц, fVCO = {:.6} МГц, RF_OUTA = {:.6} МГц\n",
            d.f_ref / 1e6,
            d.f_pfd / 1e6,
            d.f_vco / 1e6,
            d.f_out_a / 1e6
        ));
        s.push_str("# порядок записи: R7 → R0\n");
        for r in (0..NUM_REGS).rev() {
            s.push_str(&format!("R{}\t0x{:08X}\n", r, self.config_word(r)));
        }
        s
    }

    fn import_text(&mut self, text: &str) -> Result<usize> {
        let mut n = 0;
        let mut regs_new = self.regs;
        for tok in text.split(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == '=') {
            let t = tok.trim();
            let h = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X"));
            let val = match h {
                Some(h) => u32::from_str_radix(h, 16).ok(),
                None if t.len() == 8 && t.chars().all(|c| c.is_ascii_hexdigit()) => u32::from_str_radix(t, 16).ok(),
                _ => None,
            };
            if let Some(v) = val {
                let r = (v & 7) as usize;
                regs_new[r] = regs::sanitize(r, v);
                n += 1;
            }
        }
        if n == 0 {
            return Err(Error::Invalid("не найдено ни одного 32-битного слова (0x........)".into()));
        }
        self.regs = regs_new;
        Ok(n)
    }

    // ───────────── RPC ─────────────

    pub fn handle(&mut self, cmd: &str, args: Value) -> Result<Value> {
        let a = &args;
        match cmd {
            "get_state" => Ok(self.snapshot()),
            "get_meta" => Ok(json!({ "fields": FIELDS, "defaults": regs::defaults(), "version": crate::about::VERSION, "app": crate::about::info() })),
            "status" => Ok(self.status()),

            "set_field" => {
                let name: String = arg(a, "name")?;
                let value: u32 = arg(a, "value")?;
                if !regs::set(&mut self.regs, &name, value) {
                    return Err(Error::Invalid(format!("поле {} не принимает значение {}", name, value)));
                }
                self.after_change()?;
                Ok(self.snapshot())
            }
            "set_fields" => {
                let values: BTreeMap<String, u32> = arg(a, "values")?;
                for (k, v) in &values {
                    if !regs::set(&mut self.regs, k, *v) {
                        return Err(Error::Invalid(format!("поле {} не принимает значение {}", k, v)));
                    }
                }
                self.after_change()?;
                Ok(self.snapshot())
            }
            "set_register" => {
                let i: usize = arg(a, "index")?;
                let v: u32 = arg(a, "value")?;
                if i >= NUM_REGS {
                    return Err(Error::Invalid("индекс регистра 0…7".into()));
                }
                self.regs[i] = regs::sanitize(i, v);
                self.after_change()?;
                Ok(self.snapshot())
            }
            "reset_defaults" => {
                let starter = opt::<bool>(a, "starter").unwrap_or(false);
                self.regs = if starter { regs::starter() } else { regs::defaults() };
                self.after_change()?;
                Ok(self.snapshot())
            }
            "set_auto_apply" => {
                self.auto_apply = arg(a, "on")?;
                self.persist();
                if self.auto_apply {
                    self.apply()?;
                }
                Ok(self.snapshot())
            }
            "apply" => {
                let w = self.apply()?;
                if w.is_empty() {
                    self.note("Нет изменений для записи");
                }
                Ok(self.snapshot())
            }
            "write_all" => {
                self.write_all()?;
                Ok(self.snapshot())
            }
            "write_register" => {
                let i: usize = arg(a, "index")?;
                self.write_reg(i.min(7), "запись регистра вручную")?;
                Ok(self.snapshot())
            }
            "raw_transfer" => {
                let w: u32 = arg(a, "word")?;
                let miso = self.xfer(w, "raw", "произвольный SPI-кадр")?;
                Ok(json!({ "miso": miso }))
            }
            "read_register" => {
                let i: usize = arg(a, "index")?;
                let v = self.read_register(i.min(7))?;
                Ok(json!({ "index": i, "word": v, "state": self.snapshot() }))
            }
            "read_all" => {
                for r in 0..NUM_REGS {
                    self.read_register(r)?;
                }
                Ok(self.snapshot())
            }
            "clear_sticky" => {
                self.clear_sticky()?;
                Ok(self.snapshot())
            }

            "set_settings" => {
                let mut cur = serde_json::to_value(&self.settings)?;
                if let (Some(obj), Some(patch)) = (cur.as_object_mut(), a.get("patch").and_then(|p| p.as_object())) {
                    for (k, v) in patch {
                        obj.insert(k.clone(), v.clone());
                    }
                }
                self.settings = serde_json::from_value(cur)?;
                if self.settings.ref_source == "tcxo" {
                    self.settings.ref_hz = 25e6;
                }
                self.push_env();
                self.persist();
                Ok(self.snapshot())
            }

            "plan" => {
                let mut req: PlanRequest = serde_json::from_value(a.clone())?;
                if req.ref_hz <= 0.0 {
                    req.ref_hz = self.settings.ref_hz;
                }
                Ok(serde_json::to_value(plan::plan(&req))?)
            }
            "apply_plan" => {
                let fields: BTreeMap<String, u32> = arg(a, "fields")?;
                for (k, v) in &fields {
                    regs::set(&mut self.regs, k, *v);
                }
                if opt::<bool>(a, "enable_output").unwrap_or(false) {
                    regs::set(&mut self.regs, "RF_OUTA_EN", 1);
                }
                self.after_change()?;
                Ok(self.snapshot())
            }
            "tune" => {
                let hz: f64 = arg(a, "hz")?;
                let d0 = self.derived();
                let lp = self.loop_params(&d0);
                let la = loopfilter::analyze(&self.settings.loop_filter, &lp);
                let req = PlanRequest {
                    target_hz: hz,
                    ref_hz: self.settings.ref_hz,
                    channel_step_hz: opt(a, "step_hz"),
                    doubler: plan::Tri::Off,
                    div2: plan::Tri::Off,
                    r_fixed: Some(regs::get(&self.regs, "R_COUNTER").max(1)),
                    pfd_max_hz: plan::PFD_MAX_FRAC,
                    allow_16bit: true,
                    prefer_integer: false,
                    loop_bw_hz: la.fc_hz.max(1e3),
                    count: 1,
                };
                // keep the current reference path so the loop filter stays valid
                let mut req = req;
                req.doubler = if d0.doubler { plan::Tri::On } else { plan::Tri::Off };
                req.div2 = if d0.div2 { plan::Tri::On } else { plan::Tri::Off };
                let res = plan::plan(&req);
                let Some(c) = res.candidates.into_iter().next() else {
                    return Err(Error::Invalid(res.error.unwrap_or_else(|| "нет решения".into())));
                };
                for (k, v) in &c.fields {
                    regs::set(&mut self.regs, k, *v);
                }
                self.persist();
                self.apply()?;
                let st = self.sim_status();
                Ok(json!({ "candidate": c, "derived": self.derived(), "sim": st, "log_head": self.next_id - 1, "state": self.snapshot() }))
            }

            "loop_analysis" => {
                let d = self.derived();
                let lp = self.loop_params(&d);
                let la = loopfilter::analyze(&self.settings.loop_filter, &lp);
                let df0: f64 = opt(a, "df0_hz").unwrap_or(self.settings.residual_hz);
                let fast = regs::get(&self.regs, "CLK_DIV_MODE") == 1;
                let tr = loopfilter::transient(
                    &self.settings.loop_filter,
                    &lp,
                    &TransientRequest {
                        df0_hz: df0,
                        tol_hz: self.settings.lock_tol_hz,
                        m0: if d.fb_fundamental { d.m0 } else { 1 },
                        ld_window_ns: d.ld_window_ns,
                        ld_cycles: d.ld_cycles,
                        fast_lock_s: if fast { d.t_sync_s } else { 0.0 },
                    },
                );
                Ok(json!({ "params": lp, "analysis": la, "transient": tr, "filter": self.settings.loop_filter }))
            }
            "design_loop" => {
                let req: DesignRequest = arg(a, "req")?;
                let d = self.derived();
                let lp = self.loop_params(&d);
                let lf = loopfilter::design(&lp, &req);
                let la = loopfilter::analyze(&lf, &lp);
                if opt::<bool>(a, "apply").unwrap_or(false) {
                    self.settings.loop_filter = lf.clone();
                    self.push_env();
                    self.persist();
                }
                Ok(json!({ "filter": lf, "analysis": la, "params": lp }))
            }
            "phase_noise" => {
                let d = self.derived();
                let lp = self.loop_params(&d);
                let o = NoiseOptions {
                    f1: opt(a, "f1").unwrap_or(self.settings.jitter_f1),
                    f2: opt(a, "f2").unwrap_or(self.settings.jitter_f2),
                    output_b: opt(a, "output_b").unwrap_or(false),
                };
                let dither = regs::get(&self.regs, "NOISE_MODE") == 3;
                let rn = self.settings.ref_noise.clone();
                let ctx = NoiseCtx { d: &d, lf: &self.settings.loop_filter, lp, ref_noise: &rn, dither };
                Ok(serde_json::to_value(noise::compute(&ctx, &o))?)
            }
            "spectrum" => {
                let req: SpectrumRequest = serde_json::from_value(a.clone())?;
                let d = self.derived();
                let st = self.sim_status();
                let lp = self.loop_params(&d);
                let dither = regs::get(&self.regs, "NOISE_MODE") == 3;
                let rn = self.settings.ref_noise.clone();
                let ctx = NoiseCtx { d: &d, lf: &self.settings.loop_filter, lp, ref_noise: &rn, dither };
                let mut nr = noise::compute(&ctx, &NoiseOptions { f1: 1e3, f2: 1e7, output_b: req.output_b });
                let mut carrier = if req.output_b { d.pwr_b_dbm } else { d.pwr_a_dbm };
                let live = st.as_ref().map(|s| s.outputs_live).unwrap_or(d.out_a_en && !self.muted)
                    && (!req.output_b || d.out_b_en);
                if !live {
                    carrier = -80.0;
                }
                if let Some(s) = &st {
                    if s.state != "locked" && s.f_vco_now > 0.0 {
                        // unlocked: VCO wanders where VTUNE sits — show it
                        let div = if req.output_b && d.f_out_b == d.f_vco { 1.0 } else { d.m0 as f64 };
                        nr.f_out = s.f_vco_now / div;
                        for v in nr.total.iter_mut() {
                            *v += 25.0;
                        }
                    }
                }
                Ok(serde_json::to_value(noise::spectrum(&ctx, &nr, carrier, &req))?)
            }
            "power" => {
                let d = self.derived();
                let st = self.sim_status();
                let live = st.map(|s| s.outputs_live).unwrap_or(true);
                Ok(serde_json::to_value(power::estimate(&self.regs, &d, self.ce, live, self.settings.ambient_c))?)
            }

            "log" => {
                let since: u64 = opt(a, "since").unwrap_or(0);
                let v: Vec<&Txn> = self.log.iter().filter(|t| t.id > since).collect();
                Ok(json!({ "entries": v, "head": self.next_id - 1 }))
            }
            "clear_log" => {
                self.log.clear();
                Ok(json!({ "head": self.next_id - 1 }))
            }

            "list_ports" => Ok(serde_json::to_value(transport::list_ports())?),
            "scan_usb" => Ok(serde_json::to_value(transport::scan_usb()?)?),
            "list_evb_usb" => Ok(serde_json::to_value(transport::evb::list_devices()?)?),
            "connect" => {
                let kind: String = arg(a, "kind")?;
                match kind.as_str() {
                    "sim" => {
                        self.link = Box::new(VirtualChip::new(Self::env_of(&self.settings)));
                        self.dev_regs = Some(Self::defaults_written());
                        self.note("Подключён симулятор 8V97051");
                    }
                    "serial" => {
                        let path: String = arg(a, "path")?;
                        let baud: u32 = opt(a, "baud").unwrap_or(115_200);
                        let b = SerialBridge::open(&path, baud)?;
                        let id = b.info().detail;
                        self.link = Box::new(b);
                        self.dev_regs = None;
                        self.note(format!("Подключён SPI-мост {} ({}) — состояние кристалла неизвестно", path, id));
                    }
                    "evb_usb" => {
                        let selector: transport::evb::EvbSelector = arg(a, "device")?;
                        let b = transport::evb::EvbBridge::open(&selector)?;
                        self.link = Box::new(b);
                        self.dev_regs = None;
                        self.auto_apply = false;
                        self.note("Подключён штатный USB EVB. Регистры PLL не записывались; авто-запись выключена. Проверьте конфигурацию и нажмите «Записать». CE/MUTE задаются JP2/JP1; LD через USB не читается.");
                    }
                    other => return Err(Error::Invalid(format!("неизвестный тип подключения {}", other))),
                }
                self.readback = None;
                self.link_error = None;
                self.ce = true;
                self.muted = false;
                if self.auto_apply {
                    self.apply()?;
                }
                Ok(self.snapshot())
            }
            "set_pins" => {
                let caps = self.link.info().caps;
                if (a.get("ce").is_some() && !caps.ce) || (a.get("muted").is_some() && !caps.mute) {
                    return Err(Error::Invalid("Эти выводы не управляются текущим транспортом. На EVB используйте JP2 (CE), JP1 (MUTE) или поля разрешения RF-выходов.".into()));
                }
                if let Some(ce) = opt::<bool>(a, "ce") {
                    self.link.set_ce(ce)?;
                    self.ce = ce;
                    self.note(format!("Вывод CE = {}", ce as u8));
                }
                if let Some(m) = opt::<bool>(a, "muted") {
                    self.link.set_mute(m)?;
                    self.muted = m;
                    self.note(format!("Вывод MUTE = {} ({})", (!m) as u8, if m { "выходы заглушены" } else { "выходы активны" }));
                }
                Ok(self.snapshot())
            }
            "sim_control" => {
                let temp: Option<f64> = opt(a, "temp_c");
                let inj = opt::<bool>(a, "inject_spi_error").unwrap_or(false);
                let Some(sim) = self.link.as_sim() else {
                    return Err(Error::Invalid("доступно только в режиме симулятора".into()));
                };
                if let Some(t) = temp {
                    sim.set_temperature(t);
                }
                if inj {
                    sim.inject_spi_error();
                }
                if inj {
                    self.note("Симулятор: внедрён кадр с 31 тактом SCLK → SPI_ERROR");
                }
                Ok(self.snapshot())
            }
            "export_config" => Ok(json!({ "text": self.export_text() })),
            "import_config" => {
                let text: String = arg(a, "text")?;
                let n = self.import_text(&text)?;
                self.note(format!("Импортировано слов: {}", n));
                self.after_change()?;
                Ok(self.snapshot())
            }
            other => Err(Error::UnknownCommand(other.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readback_fields_only_include_observed_registers() {
        let mut e = Engine::new(None);
        assert!(e.snapshot()["readback"].is_null());
        e.read_register(6).unwrap();
        let partial = e.snapshot();
        assert!(partial["readback"]["fields"].get("DIG_LOCK").is_some());
        assert!(partial["readback"]["fields"].get("DEV_ID").is_none());
        e.read_register(7).unwrap();
        let complete = e.snapshot();
        assert_eq!(complete["readback"]["fields"]["DEV_ID"], 6);
        assert_eq!(complete["readback"]["fields"]["REV_ID"], 1);
        assert_eq!(complete["fields"]["DEV_ID"], 0); // writable configuration stays separate
        e.handle("connect", json!({"kind":"sim"})).unwrap();
        assert!(e.snapshot()["readback"].is_null());
    }

    struct TestUsbLink {
        chip: VirtualChip,
        frames: std::sync::Arc<std::sync::Mutex<Vec<u32>>>,
        fail_at: Option<usize>,
    }
    impl Link for TestUsbLink {
        fn info(&self) -> transport::LinkInfo {
            transport::LinkInfo { kind: "evb_usb", name: "test".into(), detail: String::new(),
                caps: transport::LinkCaps { readback: true, ce: false, mute: false, ld: false } }
        }
        fn transfer(&mut self, word: u32) -> Result<u32> {
            let mut frames = self.frames.lock().unwrap();
            frames.push(word);
            if self.fail_at == Some(frames.len()) { return Err(Error::Link("test disconnect".into())); }
            Ok(self.chip.transfer(word))
        }
        fn set_ce(&mut self, _: bool) -> Result<()> { panic!("unsupported CE must be rejected before transport") }
        fn set_mute(&mut self, _: bool) -> Result<()> { panic!("unsupported MUTE must be rejected before transport") }
        fn read_ld(&mut self) -> Result<Option<bool>> { Ok(None) }
    }

    #[test]
    fn native_usb_requires_known_configuration_and_respects_capabilities() {
        let mut e = Engine::new(None);
        let frames = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        e.link = Box::new(TestUsbLink { chip: VirtualChip::new(Engine::env_of(&e.settings)), frames: frames.clone(), fail_at: None });
        e.dev_regs = None;
        e.auto_apply = false;
        assert!(e.read_register(0).is_err());
        assert!(e.handle("set_pins", json!({"ce": false, "muted": true})).is_err());
        assert!(frames.lock().unwrap().is_empty());
        assert!(e.status()["ld"].is_null());
        e.handle("apply", json!({})).unwrap();
        assert_eq!(frames.lock().unwrap().iter().map(|w| w & 7).collect::<Vec<_>>(), vec![7, 6, 5, 4, 3, 2, 1, 0]);
        e.handle("read_all", json!({})).unwrap();
        assert!(e.readback.unwrap().2.iter().all(|v| *v));
        assert!(e.sim_status().is_none());
    }

    #[test]
    fn partial_usb_write_keeps_entire_configuration_unknown() {
        let mut e = Engine::new(None);
        let frames = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        e.link = Box::new(TestUsbLink { chip: VirtualChip::new(Engine::env_of(&e.settings)), frames: frames.clone(), fail_at: Some(3) });
        assert!(e.write_all().is_err());
        assert_eq!(frames.lock().unwrap().len(), 3);
        assert!(e.dev_regs.is_none());
        assert!(e.readback.is_none());
        assert!(e.snapshot()["dirty"].as_array().unwrap().iter().all(|x| x == true));
        // Readback must not write a guessed R2 while the real state is unknown.
        assert!(e.read_register(0).is_err());
        assert_eq!(frames.lock().unwrap().len(), 3);
    }

    #[test]
    fn rpc_roundtrip() {
        let mut e = Engine::new(None);
        let s = e.handle("get_state", json!({})).unwrap();
        assert!(s["derived"]["f_vco"].as_f64().unwrap() > 2e9);
        e.handle("set_field", json!({"name": "RF_OUTA_EN", "value": 1})).unwrap();
        let r = e.handle("tune", json!({"hz": 1_000_000_000.0})).unwrap();
        assert!((r["derived"]["f_out_a"].as_f64().unwrap() - 1e9).abs() < 1.0);
        e.handle("read_all", json!({})).unwrap();
        let st = e.handle("get_state", json!({})).unwrap();
        let m = st["readback"]["matches"].as_array().unwrap();
        assert!(m.iter().all(|x| x.as_bool().unwrap()), "{:?}", st["readback"]);
        let ex = e.handle("export_config", json!({})).unwrap();
        let txt = ex["text"].as_str().unwrap().to_string();
        e.handle("reset_defaults", json!({})).unwrap();
        e.handle("import_config", json!({ "text": txt })).unwrap();
        let st = e.handle("get_state", json!({})).unwrap();
        assert!((st["derived"]["f_out_a"].as_f64().unwrap() - 1e9).abs() < 1.0);
        for c in ["phase_noise", "loop_analysis", "power", "status", "log"] {
            e.handle(c, json!({})).unwrap();
        }
        e.handle("spectrum", json!({"span_hz": 10e6})).unwrap();
    }
}
