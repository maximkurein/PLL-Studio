//! Audit documented SC18 sampling modes and PLL read sequencing, RF outputs off.
use pll_core::{regs, transport::{evb::{self, EvbBridge}, Link}};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let devices = evb::list_devices()?;
    if devices.len() != 1 { return Err("Expected one EVB".into()); }
    let mut b = EvbBridge::open(&devices[0].selector)?;
    let mut w = regs::starter();
    regs::set(&mut w,"RF_OUTA_EN",0); regs::set(&mut w,"RF_OUTB_EN",0);
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        println!("GPIO {:?}", b.diagnostic_gpio()?);
        for r in (0..8).rev() { b.transfer(regs::sanitize(r,w[r]))?; }
        // Constant levels do not depend on read command or SCLKE. Inspect all
        // 200 SC18 buffer bytes for stale data / unexpected I²C read pointer.
        for mux in [1,2,1] {
            regs::set(&mut w,"MUX_OUT",mux);
            b.transfer(regs::sanitize(2,w[2]))?;
            b.transfer(regs::sanitize(0,w[0]))?;
            let data = b.diagnostic_spi_buffer(regs::sanitize(7,w[7]),200)?;
            println!("MUX={mux}, buffer first16={:02X?}, nonzero offsets={:?}", &data[..16], data.iter().enumerate().filter(|(_,v)| **v!=0).collect::<Vec<_>>());
        }
        regs::set(&mut w,"MUX_OUT",7);
        b.transfer(regs::sanitize(2,w[2]))?;
        // Renesas p.16: SCLKE=1 -> rising-edge capture (mode 0);
        // SCLKE=0 -> falling-edge capture (mode 1). Writes always in mode 0.
        for (sclke, mode) in [(1,0),(0,1)] {
            for rate in [3,2] { // documented 58 and 115 kHz
                b.diagnostic_spi_config(0,rate)?;
                regs::set(&mut w,"SCLKE",sclke);
                let r7 = regs::sanitize(7,w[7]);
                b.transfer(r7)?;
                for dummy in [r7, regs::sanitize(5,w[5]), regs::sanitize(0,w[0])] {
                    b.diagnostic_spi_config(0,rate)?;
                    b.transfer(r7 | (7<<4) | (1<<3))?;
                    b.diagnostic_spi_config(mode,rate)?; // I²C configuration adds no SPI clocks
                    let data = b.diagnostic_spi_buffer(dummy,4)?;
                    println!("SCLKE={sclke} mode={mode} rate={rate} dummy={dummy:08X} R7={data:02X?}");
                }
            }
        }
        Ok(())
    })();
    // Return bridge to standard SPI mode and known PLL config, outputs off.
    let restore = (|| -> pll_core::Result<()> {
        b.diagnostic_spi_config(0,2)?;
        regs::set(&mut w,"SCLKE",1); regs::set(&mut w,"MUX_OUT",7);
        for r in (0..8).rev() { b.transfer(regs::sanitize(r,w[r]))?; }
        Ok(())
    })();
    result?; restore?;
    Ok(())
}
