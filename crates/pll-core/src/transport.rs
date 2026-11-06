//! Hardware links: the virtual chip, a USB-serial SPI bridge (firmware in
//! /firmware), and USB / serial-port discovery used to identify the EVB.

use crate::sim::VirtualChip;
use crate::{Error, Result};
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

#[derive(Serialize, Clone, Debug)]
pub struct LinkCaps {
    pub readback: bool,
    pub ld: bool,
    pub ce: bool,
    pub mute: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct LinkInfo {
    pub kind: &'static str,
    pub name: String,
    pub detail: String,
    pub caps: LinkCaps,
}

pub trait Link: Send {
    fn info(&self) -> LinkInfo;
    /// One 32-bit SPI frame, MSB first, mode 0. Returns the bits seen on MUX_OUT/SDO.
    fn transfer(&mut self, word: u32) -> Result<u32>;
    fn set_ce(&mut self, high: bool) -> Result<()>;
    /// `muted` = drive the MUTE pin low.
    fn set_mute(&mut self, muted: bool) -> Result<()>;
    fn read_ld(&mut self) -> Result<Option<bool>>;
    fn as_sim(&mut self) -> Option<&mut VirtualChip> {
        None
    }
}

impl Link for VirtualChip {
    fn info(&self) -> LinkInfo {
        LinkInfo {
            kind: "sim",
            name: "Виртуальный 8V97051".into(),
            detail: "Поведенческая модель кристалла: SPI, двойные буферы, readback, калибровка ГУН, захват петли".into(),
            caps: LinkCaps { readback: true, ld: true, ce: true, mute: true },
        }
    }
    fn transfer(&mut self, word: u32) -> Result<u32> {
        Ok(VirtualChip::transfer(self, word))
    }
    fn set_ce(&mut self, high: bool) -> Result<()> {
        VirtualChip::set_ce(self, high);
        Ok(())
    }
    fn set_mute(&mut self, muted: bool) -> Result<()> {
        self.set_mute_pin(muted);
        Ok(())
    }
    fn read_ld(&mut self) -> Result<Option<bool>> {
        Ok(Some(self.poll().ld_pin))
    }
    fn as_sim(&mut self) -> Option<&mut VirtualChip> {
        Some(self)
    }
}

/// Text protocol over a USB-CDC serial port (see firmware/spi_bridge):
///   `?`            → `PLLBRIDGE <version> <board>`
///   `X hhhhhhhh`   → `OK hhhhhhhh`   (32-bit full-duplex frame)
///   `CE 0|1`, `MUTE 0|1` (pin level) → `OK`
///   `LD`           → `OK 0|1`
///   `SPI <hz>`     → `OK`
pub struct SerialBridge {
    port: Box<dyn serialport::SerialPort>,
    reader: BufReader<Box<dyn serialport::SerialPort>>,
    path: String,
    ident: String,
}

impl SerialBridge {
    pub fn open(path: &str, baud: u32) -> Result<Self> {
        let port = serialport::new(path, baud)
            .timeout(Duration::from_millis(400))
            .open()
            .map_err(|e| Error::Link(format!("Не удалось открыть {}: {}", path, e)))?;
        let reader = BufReader::new(port.try_clone().map_err(|e| Error::Link(e.to_string()))?);
        let mut b = SerialBridge { port, reader, path: path.to_string(), ident: String::new() };
        // Boards with auto-reset (classic Arduino) need time to boot.
        let mut ok = false;
        for attempt in 0..12 {
            if attempt == 1 {
                std::thread::sleep(Duration::from_millis(600));
            }
            let _ = b.port.clear(serialport::ClearBuffer::Input);
            if let Ok(r) = b.raw("?") {
                if r.starts_with("PLLBRIDGE") {
                    b.ident = r;
                    ok = true;
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        if !ok {
            return Err(Error::Link(format!(
                "{}: нет ответа PLLBRIDGE — прошейте firmware/spi_bridge и проверьте скорость порта",
                path
            )));
        }
        Ok(b)
    }

    fn raw(&mut self, line: &str) -> Result<String> {
        self.port
            .write_all(format!("{}\n", line).as_bytes())
            .map_err(|e| Error::Link(e.to_string()))?;
        self.port.flush().ok();
        let mut s = String::new();
        loop {
            s.clear();
            self.reader.read_line(&mut s).map_err(|e| Error::Link(format!("таймаут ответа моста: {}", e)))?;
            let t = s.trim();
            if !t.is_empty() && !t.starts_with('#') {
                return Ok(t.to_string());
            }
        }
    }

    fn cmd(&mut self, line: &str) -> Result<String> {
        let r = self.raw(line)?;
        if let Some(rest) = r.strip_prefix("OK") {
            Ok(rest.trim().to_string())
        } else {
            Err(Error::Link(format!("мост ответил: {}", r)))
        }
    }
}

impl Link for SerialBridge {
    fn info(&self) -> LinkInfo {
        LinkInfo {
            kind: "serial",
            name: format!("SPI-мост {}", self.path),
            detail: self.ident.clone(),
            caps: LinkCaps { readback: true, ld: true, ce: true, mute: true },
        }
    }
    fn transfer(&mut self, word: u32) -> Result<u32> {
        let r = self.cmd(&format!("X {:08X}", word))?;
        u32::from_str_radix(r.trim(), 16).map_err(|_| Error::Link(format!("неверный ответ: {}", r)))
    }
    fn set_ce(&mut self, high: bool) -> Result<()> {
        self.cmd(&format!("CE {}", high as u8)).map(|_| ())
    }
    fn set_mute(&mut self, muted: bool) -> Result<()> {
        self.cmd(&format!("MUTE {}", (!muted) as u8)).map(|_| ())
    }
    fn read_ld(&mut self) -> Result<Option<bool>> {
        let r = self.cmd("LD")?;
        Ok(Some(r.trim() == "1"))
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct PortInfo {
    pub path: String,
    pub kind: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
}

pub fn list_ports() -> Vec<PortInfo> {
    let mut v: Vec<PortInfo> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let mut info = PortInfo {
                path: p.port_name.clone(),
                kind: "other".into(),
                vid: None,
                pid: None,
                manufacturer: None,
                product: None,
                serial: None,
            };
            match p.port_type {
                serialport::SerialPortType::UsbPort(u) => {
                    info.kind = "usb".into();
                    info.vid = Some(u.vid);
                    info.pid = Some(u.pid);
                    info.manufacturer = u.manufacturer;
                    info.product = u.product;
                    info.serial = u.serial_number;
                }
                serialport::SerialPortType::BluetoothPort => info.kind = "bluetooth".into(),
                serialport::SerialPortType::PciPort => info.kind = "pci".into(),
                serialport::SerialPortType::Unknown => {}
            }
            info
        })
        .collect();
    // macOS lists /dev/tty.* and /dev/cu.* for the same device: keep cu.*
    if cfg!(target_os = "macos") {
        v.retain(|p| !p.path.starts_with("/dev/tty."));
    }
    v
}

#[derive(Serialize, Clone, Debug)]
pub struct UsbDev {
    pub vid: u16,
    pub pid: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
    pub bus: u8,
    pub address: u8,
    pub hint: Option<&'static str>,
    pub likely_bridge: bool,
}

fn vendor_hint(vid: u16, pid: u16) -> (Option<&'static str>, bool) {
    match (vid, pid) {
        (0x0403, _) => (Some("FTDI — типичный USB-SPI мост (MPSSE: FT232H/FT2232H/FT4232H)"), true),
        (0x04B4, _) => (Some("Cypress/Infineon — USB-мост (FX2LP / CY7C652xx)"), true),
        (0x10C4, 0x87A0) => (Some("Silicon Labs CP2130 — USB-SPI мост"), true),
        (0x10C4, _) => (Some("Silicon Labs — USB-мост (CP21xx)"), true),
        (0x04D8, 0x00DE) => (Some("Microchip MCP2210 — USB-SPI мост"), true),
        (0x04D8, _) => (Some("Microchip — USB-устройство / микроконтроллер"), true),
        (0x045B, _) => (Some("Renesas — возможно, интерфейс оценочной платы"), true),
        (0x0451, _) => (Some("Texas Instruments — USB-контроллер"), true),
        (0x1FC9, _) => (Some("NXP — USB-контроллер"), true),
        (0x0483, 0x3748) | (0x0483, 0x374B) | (0x0483, 0x374E) | (0x0483, 0x374F) | (0x0483, 0x3752) | (0x0483, 0x3753) => {
            (Some("ST-LINK — можно использовать Nucleo как SPI-мост (firmware/spi_bridge)"), false)
        }
        (0x0483, _) => (Some("STMicroelectronics — USB-устройство"), false),
        (0x2E8A, _) => (Some("Raspberry Pi RP2040/RP2350 — подходит как SPI-мост"), false),
        (0x2341, _) | (0x2A03, _) => (Some("Arduino"), false),
        (0x239A, _) => (Some("Adafruit"), false),
        (0x067B, _) => (Some("Prolific PL2303 — USB-UART (без SPI)"), false),
        (0x1A86, _) => (Some("WCH CH34x — USB-UART"), false),
        (0x05AC, _) => (Some("Apple"), false),
        _ => (None, false),
    }
}

pub fn scan_usb() -> Result<Vec<UsbDev>> {
    let list = nusb::list_devices().map_err(|e| Error::Link(format!("USB: {}", e)))?;
    let mut v: Vec<UsbDev> = list
        .filter(|d| d.class() != 0x09) // skip hubs
        .map(|d| {
            let (hint, likely) = vendor_hint(d.vendor_id(), d.product_id());
            UsbDev {
                vid: d.vendor_id(),
                pid: d.product_id(),
                manufacturer: d.manufacturer_string().map(|s| s.to_string()),
                product: d.product_string().map(|s| s.to_string()),
                serial: d.serial_number().map(|s| s.to_string()),
                bus: d.bus_number(),
                address: d.device_address(),
                hint,
                likely_bridge: likely,
            }
        })
        .collect();
    v.sort_by_key(|d| (!d.likely_bridge, d.vid, d.pid));
    Ok(v)
}
