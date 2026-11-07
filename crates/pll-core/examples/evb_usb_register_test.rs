//! Hardware test: writes a known configuration with both RF outputs disabled.
//! Explicit --write-read is required. Leaves this disabled-output configuration on the board.
use pll_core::{regs, transport::evb, Engine, Error};
use serde_json::{json, Value};
use std::time::Instant;

fn check(e: &mut Engine, label: &str) -> Result<(), Box<dyn std::error::Error>> {
    let state = e.handle("read_all", json!({}))?;
    let rb = &state["readback"];
    let mut mismatches = vec![];
    let mut words = [0u32; regs::NUM_REGS];
    for r in 0..regs::NUM_REGS {
        words[r] = rb["words"][r].as_u64().ok_or("missing readback")? as u32;
        let expected = state["regs"][r].as_u64().ok_or("missing register")? as u32;
        let matches = rb["valid"][r] == true && rb["matches"][r] == true;
        println!("{label} R{r}: write {expected:08X}, read {:08X}, {}", words[r], if matches { "OK" } else { "MISMATCH" });
        if !matches { mismatches.push(r); }
    }
    println!("DEV_ID={}, REV_ID={}, SPI_ERROR={}", regs::get(&words, "DEV_ID"), regs::get(&words, "REV_ID"), regs::get(&words, "SPI_ERROR"));
    if !mismatches.is_empty() { return Err(Error::Link(format!("Несовпадение регистров: {mismatches:?}")).into()); }
    if regs::get(&words, "DEV_ID") != 6 { return Err("DEV_ID differs from 8V97051".into()); }
    if regs::get(&words, "RF_OUTA_EN") != 0 || regs::get(&words, "RF_OUTB_EN") != 0 { return Err("RF outputs are not disabled".into()); }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if !std::env::args().any(|a| a == "--write-read") { return Err("Требуется --write-read: тест запишет конфигурацию с отключёнными RF-выходами".into()); }
    let devices = evb::list_devices()?;
    if devices.len() != 1 { return Err("Требуется ровно одна подключённая EVB".into()); }
    let mut e = Engine::new(None);
    e.handle("set_auto_apply", json!({"on": false}))?;
    e.handle("set_fields", json!({"values": {"RF_OUTA_EN":0,"RF_OUTB_EN":0,"INT":100,"MUX_OUT":7,"SCLKE":1}}))?;
    let begin = Instant::now();
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        e.handle("connect", json!({"kind":"evb_usb","device":devices[0].selector}))?;
        println!("Штатный мост подключён. Записываю R7→R0, оба RF-выхода отключены.");
        e.handle("write_all", json!({}))?;
        check(&mut e, "INT=100")?;
        e.handle("set_field", json!({"name":"INT","value":101}))?;
        e.handle("apply", json!({}))?;
        check(&mut e, "INT=101")?;
        e.handle("set_field", json!({"name":"INT","value":100}))?;
        e.handle("apply", json!({}))?;
        check(&mut e, "INT=100 restored")?;
        Ok(())
    })();
    let log: Value = e.handle("log", json!({}))?;
    if result.is_err() { let path = std::env::temp_dir().join("pll-evb-register-test-log.json"); std::fs::write(&path, serde_json::to_string_pretty(&log)?)?; println!("SPI log: {}", path.display()); }
    println!("Время теста: {:.1} с. Переданы команды отключения RF; фактическое состояние подтверждается только успешным readback.", begin.elapsed().as_secs_f64());
    result
}
