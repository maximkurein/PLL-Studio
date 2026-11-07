//! Visual SPI write test, only R5. Restores Digital Lock Detect (not unknown prior R5).
use pll_core::{regs, transport::{evb::{self, EvbBridge}, Link}};
use std::{thread, time::Duration};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if !std::env::args().any(|a| a == "--blink") {
        return Err("Требуется --blink: три мигания LD через R5, затем Digital Lock Detect".into());
    }
    let devices = evb::list_devices()?;
    if devices.len() != 1 { return Err("Требуется ровно одна EVB".into()); }
    let mut bridge = EvbBridge::open(&devices[0].selector)?;
    let mut words = regs::defaults();
    let mut write_mode = |mode: u32| -> pll_core::Result<()> {
        regs::set(&mut words, "LD_PIN_MODE", mode);
        let word = regs::sanitize(5, words[5]);
        bridge.transfer(word)?;
        println!("R5={word:08X}, LD_PIN_MODE={mode}");
        Ok(())
    };
    println!("Смотрите на LD. Начало через 5 секунд. Из регистров PLL записывается только R5.");
    thread::sleep(Duration::from_secs(5));
    let result = (|| -> pll_core::Result<()> {
        write_mode(0)?;
        for cycle in 1..=3 {
            println!("Мигание {cycle}: HIGH");
            write_mode(3)?;
            thread::sleep(Duration::from_secs(2));
            println!("Мигание {cycle}: LOW");
            write_mode(0)?;
            thread::sleep(Duration::from_secs(2));
        }
        Ok(())
    })();
    let restore = write_mode(1);
    result?;
    restore?;
    println!("Команды переданы, R5 возвращён в Digital Lock Detect. Фактическое мигание должен подтвердить наблюдатель.");
    Ok(())
}
