//! Isolate the MISO path using documented constant MUX_OUT levels, RF outputs disabled.
use pll_core::{regs, transport::{evb::{self, EvbBridge}, Link}};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let devices = evb::list_devices()?;
    if devices.len() != 1 { return Err("Expected one EVB".into()); }
    let mut b = EvbBridge::open(&devices[0].selector)?;
    let gpio = b.diagnostic_gpio()?;
    println!("SC18 GPIO diagnostics: {gpio:02X?}");
    if gpio.iter().any(|(written, read)| written & 0x0e != read & 0x0e) { return Err("SC18 GPIO verification failed".into()); }
    let mut w = regs::starter();
    regs::set(&mut w, "RF_OUTA_EN", 0);
    regs::set(&mut w, "RF_OUTB_EN", 0);
    for r in (0..8).rev() { b.transfer(regs::sanitize(r, w[r]))?; }
    for mux in [1,2,1,7] {
        regs::set(&mut w, "MUX_OUT", mux);
        b.transfer(regs::sanitize(2,w[2]))?;
        let read = b.transfer(regs::sanitize(7,w[7]))?;
        println!("MUX_OUT={mux}: MISO={read:08X}");
    }
    Ok(())
}
