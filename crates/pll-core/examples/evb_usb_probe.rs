//! Probe the single connected EVB bridge; configures USB/I2C/SPI, never writes PLL registers.
use pll_core::{transport::{evb::{self, EvbBridge}, Link}, Error};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let devices = evb::list_devices()?;
    if devices.len() != 1 {
        return Err(Error::Invalid(format!("Ожидалась одна EVB, найдено {}. Используйте выбор в приложении.", devices.len())).into());
    }
    let bridge = EvbBridge::open(&devices[0].selector)?;
    println!("{}", serde_json::to_string_pretty(&bridge.info())?);
    println!("SC18IS602 отвечает; регистры PLL не записывались.");
    Ok(())
}
