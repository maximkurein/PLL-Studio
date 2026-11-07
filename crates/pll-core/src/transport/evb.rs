//! Native Rev A EVB: FT2232 channel A -> I²C (0x28) -> SC18IS602 SS0 -> PLL.
//! Wiring: vendor schematic 2015-05-14, PDF page 2 (AD0=SCL, AD1/AD2=SDA).
//! Protocol sources: NXP SC18IS602_602B_603 Rev.04 §§7.1.1–7.1.6;
//! FTDI AN_108 v1.5 §§3.1, 3.6, 3.7, 5.1; USB requests: Linux ftdi_sio.h.
//!
//! Deliberately use MPSSE GPIO direction switching, not the shift engine:
//! FT2232D lacks drive-zero, and SC18IS602 can stretch SCL. Never drive HIGH;
//! release the line and sample the actual SCL pin on every clock. This is slow
//! (USB round trips per bit), but supports the original full-speed FT2232.

use super::{Link, LinkCaps, LinkInfo};
use crate::{Error, Result};
use nusb::transfer::{Control, ControlType, Direction, EndpointType, Recipient, RequestBuffer};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};
use std::time::{Duration, Instant};

const ADDRESS: u8 = 0x28; // A2=A1=A0=0 on Rev A, 7-bit address
const IO_TIMEOUT: Duration = Duration::from_millis(500);
const TRANSACTION_TIMEOUT: Duration = Duration::from_secs(5);
const SCL: u8 = 1;
const SDA_OUT: u8 = 2;
const SDA_IN: u8 = 4;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvbSelector {
    pub bus: u8,
    pub address: u8,
    pub serial: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EvbDevice {
    pub selector: EvbSelector,
    pub product: Option<String>,
    pub manufacturer: Option<String>,
    pub device_version: u16,
}

fn supported(d: &nusb::DeviceInfo) -> bool {
    d.vendor_id() == 0x0403 && d.product_id() == 0x6010
        && matches!(d.device_version(), 0x0500 | 0x0700)
}

/// Descriptors only: no claim, MPSSE setup, I²C probing or PLL writes.
pub fn list_devices() -> Result<Vec<EvbDevice>> {
    Ok(nusb::list_devices().map_err(usb_error)?.filter(supported).map(|d| EvbDevice {
        selector: EvbSelector { bus: d.bus_number(), address: d.device_address(), serial: d.serial_number().map(str::to_owned) },
        product: d.product_string().map(str::to_owned),
        manufacturer: d.manufacturer_string().map(str::to_owned),
        device_version: d.device_version(),
    }).collect())
}

fn usb_error(e: impl std::fmt::Display) -> Error {
    Error::Link(format!("USB EVB: {}", e))
}

struct ThreadWake(std::thread::Thread);
impl Wake for ThreadWake {
    fn wake(self: Arc<Self>) { self.0.unpark(); }
    fn wake_by_ref(self: &Arc<Self>) { self.0.unpark(); }
}

/// nusb cancels a transfer when its future is dropped. On timeout the whole
/// link is poisoned: never retry an uncertain/partially completed SPI write.
fn wait_until<F: Future>(f: F, deadline: Instant) -> Result<F::Output> {
    let waker = Waker::from(Arc::new(ThreadWake(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    let mut f = std::pin::pin!(f);
    loop {
        if Instant::now() >= deadline {
            return Err(usb_error("таймаут обмена; состояние платы неизвестно, подключитесь заново"));
        }
        match f.as_mut().poll(&mut cx) {
            Poll::Ready(v) => return Ok(v),
            Poll::Pending => std::thread::park_timeout(deadline.saturating_duration_since(Instant::now())),
        }
    }
}

/// Every USB packet has its own two FTDI status bytes, including empty replies.
fn payload(raw: &[u8], packet_size: usize) -> Result<Vec<u8>> {
    if packet_size < 2 { return Err(usb_error("неверный размер USB-пакета")); }
    let mut out = Vec::new();
    for packet in raw.chunks(packet_size) {
        if packet.len() < 2 { return Err(usb_error("оборван заголовок FTDI")); }
        if packet[1] & 0x1e != 0 { return Err(usb_error("FTDI сообщил ошибку приёма")); }
        out.extend_from_slice(&packet[2..]);
    }
    Ok(out)
}

trait MpsseIo {
    fn exchange(&mut self, command: &[u8], count: usize, deadline: Instant) -> Result<Vec<u8>>;
}

struct Ftdi {
    interface: nusb::Interface,
    ep_in: u8,
    ep_out: u8,
    packet_size: usize,
}

impl Ftdi {
    fn control(&self, request: u8, value: u16) -> Result<()> {
        self.interface.control_out_blocking(Control {
            control_type: ControlType::Vendor, recipient: Recipient::Device,
            request, value, index: 1, // FTDI channel A is 1-based; USB interface is 0
        }, &[], IO_TIMEOUT).map_err(usb_error)?;
        Ok(())
    }

    fn open(selector: &EvbSelector) -> Result<Self> {
        let mut matches = nusb::list_devices().map_err(usb_error)?.filter(|d| {
            supported(d) && d.bus_number() == selector.bus && d.device_address() == selector.address
                && d.serial_number() == selector.serial.as_deref()
        });
        let info = matches.next().ok_or_else(|| usb_error("выбранный FT2232 не найден; обновите список устройств"))?;
        if matches.next().is_some() { return Err(usb_error("неоднозначный выбор USB-устройства")); }
        let device = info.open().map_err(|e| usb_error(format!("не удалось открыть FT2232: {e}. Закройте Timing Commander и другие программы, использующие плату.")))?;
        // No automatic kernel-driver removal or system-wide USB resets.
        let interface = device.claim_interface(0).map_err(|e| usb_error(format!(
            "не удалось занять канал A: {e}. Windows: нужен WinUSB для интерфейса A; macOS/Linux: проверьте права и занятость канала драйвером VCP. См. руководство штатного USB."
        )))?;
        let alt = interface.descriptors().find(|a| a.alternate_setting() == 0)
            .ok_or_else(|| usb_error("нет основного интерфейса A"))?;
        let input = alt.endpoints().find(|e| e.transfer_type() == EndpointType::Bulk && e.direction() == Direction::In)
            .ok_or_else(|| usb_error("нет bulk IN"))?;
        let output = alt.endpoints().find(|e| e.transfer_type() == EndpointType::Bulk && e.direction() == Direction::Out)
            .ok_or_else(|| usb_error("нет bulk OUT"))?;
        let mut f = Self { ep_in: input.address(), ep_out: output.address(), packet_size: input.max_packet_size(), interface };
        f.control(0x0b, 0)?; // reset bit mode, all inputs
        f.control(0x00, 1)?; // purge RX
        f.control(0x00, 2)?; // purge TX
        f.control(0x09, 2)?; // latency 2 ms, compatible with FT2232D
        f.control(0x06, 0)?; // disable event character
        f.control(0x07, 0)?; // disable error character
        f.control(0x0b, 0x0200)?; // MPSSE (mode 2), all inputs
        std::thread::sleep(Duration::from_millis(50));
        let answer = f.exchange(&[0xaa, 0x87], 2, Instant::now() + IO_TIMEOUT)?;
        if answer != [0xfa, 0xaa] { return Err(usb_error("FT2232 не подтвердил режим MPSSE")); }
        // Disable loopback. Other GPIO remain inputs. No SC18 reset or PLL write.
        f.exchange(&[0x85, 0x80, 0, 0, 0x81, 0x87], 1, Instant::now() + IO_TIMEOUT)?;
        Ok(f)
    }
}

impl MpsseIo for Ftdi {
    fn exchange(&mut self, command: &[u8], count: usize, deadline: Instant) -> Result<Vec<u8>> {
        let end = deadline.min(Instant::now() + IO_TIMEOUT);
        let sent = wait_until(self.interface.bulk_out(self.ep_out, command.to_vec()), end)?.into_result().map_err(usb_error)?;
        if sent.actual_length() != command.len() { return Err(usb_error("неполная USB-запись")); }
        let mut bytes = Vec::new();
        while bytes.len() < count {
            let raw = wait_until(self.interface.bulk_in(self.ep_in, RequestBuffer::new(self.packet_size)), end)?
                .into_result().map_err(usb_error)?;
            bytes.extend(payload(&raw, self.packet_size)?);
        }
        if bytes.len() != count { return Err(usb_error("лишние данные FTDI; нарушена синхронизация")); }
        Ok(bytes)
    }
}

impl Drop for Ftdi {
    fn drop(&mut self) {
        // Best effort release of MPSSE GPIO. UART mode may drive TXD/SCL HIGH,
        // so do not return to UART here. Never reset the device or its EEPROM.
        let _ = self.control(0x00, 2);
        let _ = self.control(0x0b, 0x0200);
    }
}

struct I2c<T> { io: T, deadline: Instant }
impl<T: MpsseIo> I2c<T> {
    fn new(io: T) -> Self { Self { io, deadline: Instant::now() + TRANSACTION_TIMEOUT } }
    fn sample(&mut self) -> Result<u8> {
        Ok(self.io.exchange(&[0x81, 0x87], 1, self.deadline)?[0])
    }
    fn lines(&mut self, scl_high: bool, sda_high: bool) -> Result<u8> {
        // Output values are ALWAYS zero. High means high-impedance with board pull-up.
        let direction = if scl_high { 0 } else { SCL } | if sda_high { 0 } else { SDA_OUT };
        Ok(self.io.exchange(&[0x80, 0, direction, 0x81, 0x87], 1, self.deadline)?[0])
    }
    fn high(&mut self, sda_high: bool) -> Result<u8> {
        let mut pins = self.lines(true, sda_high)?;
        let until = self.deadline.min(Instant::now() + Duration::from_millis(100));
        while pins & SCL == 0 {
            if Instant::now() >= until { return Err(usb_error(format!("SCL удерживается в 0 (clock stretching / питание SPI / замыкание); FTDI GPIO=0x{pins:02X}"))); }
            pins = self.sample()?;
        }
        Ok(pins)
    }
    fn start(&mut self) -> Result<()> {
        self.deadline = Instant::now() + TRANSACTION_TIMEOUT;
        if self.high(true)? & SDA_IN == 0 { return Err(usb_error("шина I²C занята: SDA = 0")); }
        self.lines(true, false)?; // START
        self.lines(false, false)?;
        Ok(())
    }
    fn stop(&mut self) -> Result<()> {
        self.lines(false, false)?;
        self.high(false)?;
        self.lines(true, true)?; // STOP
        Ok(())
    }
    fn bit(&mut self, release: bool) -> Result<bool> {
        self.lines(false, release)?;
        let one = self.high(release)? & SDA_IN != 0;
        self.lines(false, release)?;
        Ok(one)
    }
    fn write_byte(&mut self, byte: u8) -> Result<bool> {
        for i in (0..8).rev() { self.bit(byte & (1 << i) != 0)?; }
        Ok(!self.bit(true)?) // slave ACK is low
    }
    fn read_byte(&mut self, last: bool) -> Result<u8> {
        let mut byte = 0;
        for _ in 0..8 { byte = (byte << 1) | u8::from(self.bit(true)?); }
        self.bit(last)?; // ACK all but last, then NACK
        Ok(byte)
    }
    fn finish<R>(&mut self, result: Result<R>) -> Result<R> {
        let stop = self.stop(); // best effort STOP on NACK/error; never hide original error
        match result { Ok(v) => stop.map(|_| v), Err(e) => Err(e) }
    }
    fn write(&mut self, data: &[u8]) -> Result<()> {
        self.start()?;
        let result = (|| {
            if !self.write_byte(ADDRESS << 1)? { return Err(usb_error("SC18IS602 не ответил ACK по адресу 0x28")); }
            for (i, &byte) in data.iter().enumerate() {
                if !self.write_byte(byte)? { return Err(usb_error(format!("SC18IS602: NACK байта {i}; запись не повторяется"))); }
            }
            Ok(())
        })();
        self.finish(result)
    }
    // Read buffer doubles as completion polling: busy SC18 does not ACK its address.
    // Only retry address NACK, NEVER resend an SPI data payload.
    fn read_buffer(&mut self, count: usize) -> Result<Vec<u8>> {
        for attempt in 0..20 {
            self.start()?;
            let addressed = self.write_byte((ADDRESS << 1) | 1);
            match addressed {
                Ok(false) => {
                    self.stop()?;
                    if attempt < 19 { std::thread::sleep(Duration::from_millis(1)); }
                }
                Ok(true) => {
                    let result = (0..count).map(|i| self.read_byte(i + 1 == count)).collect();
                    return self.finish(result);
                }
                Err(e) => return self.finish(Err(e)),
            }
        }
        Err(usb_error("SC18IS602 не завершил команду: нет ACK при чтении буфера"))
    }
}

pub struct EvbBridge { bus: I2c<Ftdi>, name: String, failed: bool }
impl EvbBridge {
    /// Diagnostic only: documented SC18 mode/rate fields (NXP table 5).
    pub fn diagnostic_spi_config(&mut self, mode: u8, rate: u8) -> Result<()> {
        if mode > 3 || rate > 3 { return Err(usb_error("неверный режим SPI")); }
        self.bus.write(&[0xf0, (mode << 2) | rate])?;
        self.bus.read_buffer(1)?;
        Ok(())
    }

    /// Capture more than four buffer bytes to detect an unexpected buffer offset.
    /// Only the four supplied bytes are clocked on SPI; extra reads are I²C-only.
    pub fn diagnostic_spi_buffer(&mut self, word: u32, count: usize) -> Result<Vec<u8>> {
        if !(4..=200).contains(&count) { return Err(usb_error("размер буфера 4…200")); }
        let b = word.to_be_bytes();
        self.bus.write(&[0xf1])?; // diagnostic comparison with explicit interrupt clear
        self.bus.read_buffer(1)?;
        self.bus.write(&[1, b[0], b[1], b[2], b[3]])?;
        std::thread::sleep(Duration::from_millis(5));
        self.bus.read_buffer(count)
    }

    /// Rev A: SS1/SS2/SS3 are unconnected. Diagnose I²C buffer reads without
    /// touching SS0 or generating any SPI clocks; restore GPIO enable afterward.
    pub fn diagnostic_gpio(&mut self) -> Result<Vec<(u8, u8)>> {
        self.bus.write(&[0xf6, 0x0e])?;
        let result = (|| {
            let mut values = Vec::new();
            for value in [0x0a, 0x04, 0x0e] {
                self.bus.write(&[0xf4, value])?;
                self.bus.write(&[0xf5, 0x0e])?;
                let read = self.bus.read_buffer(1)?[0];
                values.push((value, read));
            }
            Ok(values)
        })();
        let restore = self.bus.write(&[0xf6, 0]);
        match result { Ok(v) => restore.map(|_| v), Err(e) => Err(e) }
    }

    pub fn open(selector: &EvbSelector) -> Result<Self> {
        let mut bus = I2c::new(Ftdi::open(selector)?);
        // Address-only buffer read probes bridge readiness without SPI activity.
        bus.read_buffer(1)?;
        // mode 0, MSB first, 115 kHz; SS0 remains a slave-select, not GPIO.
        bus.write(&[0xf0, 0x02])?;
        bus.read_buffer(1)?;
        bus.write(&[0xf6, 0x00])?;
        bus.read_buffer(1)?;
        Ok(Self { bus, name: format!("EVB USB {}:{}", selector.bus, selector.address), failed: false })
    }
}
impl Link for EvbBridge {
    fn info(&self) -> LinkInfo {
        LinkInfo {
            kind: "evb_usb", name: self.name.clone(),
            detail: "FT2232 A → I²C 0x28 → SC18IS602 SS0; SPI 115 кГц. Экспериментальный транспорт Rev A".into(),
            caps: LinkCaps { readback: true, ld: false, ce: false, mute: false },
        }
    }
    fn transfer(&mut self, word: u32) -> Result<u32> {
        if self.failed { return Err(usb_error("после ошибки требуется переподключение; запись не повторяется")); }
        let result = spi_transfer(&mut self.bus, word);
        if result.is_err() { self.failed = true; }
        result
    }
    fn set_ce(&mut self, _: bool) -> Result<()> { Err(usb_error("CE не подключён к штатному мосту; используйте JP2")) }
    fn set_mute(&mut self, _: bool) -> Result<()> { Err(usb_error("MUTE не подключён к штатному мосту; используйте JP1 или поля RF_OUTA_EN/RF_OUTB_EN")) }
    fn read_ld(&mut self) -> Result<Option<bool>> { Ok(None) }
}

fn spi_transfer<T: MpsseIo>(bus: &mut I2c<T>, word: u32) -> Result<u32> {
    let b = word.to_be_bytes();
    bus.write(&[0x01, b[0], b[1], b[2], b[3]])?; // one SS0 assertion for all 32 bits
    let data = bus.read_buffer(4)?;
    Ok(u32::from_be_bytes(data.try_into().map_err(|_| usb_error("неполный SPI-ответ"))?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    // Decode the actual GPIO transitions as an I²C slave, rather than asserting
    // an implementation-generated MPSSE byte array against an identical array.
    struct Slave {
        dir: u8,
        active: bool,
        reading: bool,
        bit: u8,
        byte: u8,
        packet: Vec<u8>,
        packets: Vec<Vec<u8>>,
        data: VecDeque<u8>,
        master_acks: Vec<bool>,
        pins: u8,
        nack_reads: usize,
        nack_data: bool,
        stretch: usize,
        samples: usize,
        fail: bool,
    }
    impl Slave {
        fn new(data: &[u8]) -> Self {
            Self { dir: 0, active: false, reading: false, bit: 0, byte: 0,
                packet: vec![], packets: vec![], data: data.iter().copied().collect(),
                master_acks: vec![], pins: SCL | SDA_IN, nack_reads: 0, nack_data: false,
                stretch: 0, samples: 0, fail: false }
        }
        fn lines(&mut self, dir: u8) {
            assert_eq!(dir & !3, 0, "AD2 and all unrelated GPIO must stay inputs");
            let old_clock = self.dir & SCL == 0;
            let clock = dir & SCL == 0;
            let old_data = self.dir & SDA_OUT == 0;
            let data = dir & SDA_OUT == 0;
            self.dir = dir;
            self.pins = if clock { SCL } else { 0 } | if data { SDA_IN } else { 0 };
            if old_clock && clock && old_data && !data { // START
                assert!(!self.active, "unexpected repeated start");
                self.active = true; self.reading = false; self.bit = 0; self.byte = 0;
                self.packet.clear();
            } else if old_clock && clock && !old_data && data { // STOP
                self.active = false;
                self.packets.push(std::mem::take(&mut self.packet));
            } else if !old_clock && clock && self.active {
                if self.reading {
                    if self.bit < 8 {
                        let b = *self.data.front().expect("unexpected extra buffer read");
                        self.pins = SCL | if b & (0x80 >> self.bit) != 0 { SDA_IN } else { 0 };
                        self.bit += 1;
                    } else {
                        self.master_acks.push(!data);
                        self.data.pop_front();
                        self.bit = 0;
                        if data { self.active = false; } // NACK ends data phase
                    }
                } else if self.bit < 8 {
                    self.byte = (self.byte << 1) | u8::from(data);
                    self.bit += 1;
                } else {
                    assert!(data, "master must release SDA during slave ACK");
                    let address = self.packet.is_empty();
                    let read = address && self.byte == 0x51;
                    let nack = if read && self.nack_reads > 0 { self.nack_reads -= 1; true }
                        else { !address && self.nack_data };
                    self.packet.push(self.byte);
                    self.pins = SCL | if nack { SDA_IN } else { 0 };
                    self.bit = 0; self.byte = 0;
                    self.reading = read && !nack;
                    if nack { self.active = false; }
                }
            }
        }
    }
    impl MpsseIo for Slave {
        fn exchange(&mut self, command: &[u8], count: usize, _: Instant) -> Result<Vec<u8>> {
            if self.fail { return Err(usb_error("test disconnect")); }
            assert_eq!(count, 1);
            match command {
                [0x80, value, dir, 0x81, 0x87] => {
                    assert_eq!(*value, 0, "must never actively drive either I²C line high");
                    self.lines(*dir);
                }
                [0x81, 0x87] => { self.samples += 1; }
                _ => panic!("unexpected command: {command:?}"),
            }
            if self.pins & SCL != 0 && self.stretch > 0 {
                self.stretch -= 1;
                return Ok(vec![self.pins & !SCL]);
            }
            Ok(vec![self.pins])
        }
    }

    #[test]
    fn spi_frame_is_one_ss0_transaction_and_readback_is_big_endian() {
        let mut bus = I2c::new(Slave::new(&[0x12, 0x34, 0xab, 0xcd]));
        assert_eq!(spi_transfer(&mut bus, 0x89abcdef).unwrap(), 0x1234abcd);
        assert_eq!(bus.io.packets, [vec![0x50, 0x01, 0x89, 0xab, 0xcd, 0xef], vec![0x51]]);
        assert_eq!(bus.io.master_acks, [true, true, true, false]);
        assert_eq!(bus.io.dir, 0, "STOP must release the bus");
    }

    #[test]
    fn busy_bridge_retries_only_read_address_not_spi_write() {
        let mut slave = Slave::new(&[0xde, 0xad, 0xbe, 0xef]);
        slave.nack_reads = 2;
        let mut bus = I2c::new(slave);
        assert_eq!(spi_transfer(&mut bus, 0x01020304).unwrap(), 0xdeadbeef);
        assert_eq!(bus.io.packets, [vec![0x50, 1, 1, 2, 3, 4], vec![0x51], vec![0x51], vec![0x51]]);
    }

    #[test]
    fn data_nack_stops_transaction_without_replaying_payload() {
        let mut slave = Slave::new(&[]);
        slave.nack_data = true;
        let mut bus = I2c::new(slave);
        assert!(spi_transfer(&mut bus, 0x01020304).unwrap_err().to_string().contains("NACK"));
        assert_eq!(bus.io.packets, [vec![0x50, 1]]);
        assert_eq!(bus.io.dir, 0);
    }

    #[test]
    fn honors_stretched_clock_and_propagates_disconnect() {
        let mut slave = Slave::new(&[]);
        slave.stretch = 3;
        let mut bus = I2c::new(slave);
        bus.write(&[0xf0, 2]).unwrap();
        assert_eq!(bus.io.samples, 3);
        assert_eq!(bus.io.packets, [vec![0x50, 0xf0, 2]]);
        bus.io.fail = true;
        assert!(bus.write(&[0xf0, 2]).unwrap_err().to_string().contains("disconnect"));
    }

    #[test]
    fn strips_status_from_every_ftdi_packet_including_empty_ones() {
        let mut raw = vec![0x01, 0x60];
        raw.extend(0u8..62);
        raw.extend([0x01, 0x60, 0xab, 0xcd]);
        let mut expected: Vec<u8> = (0..62).collect();
        expected.extend([0xab, 0xcd]);
        assert_eq!(payload(&raw, 64).unwrap(), expected);
        assert!(payload(&[1, 0x60], 64).unwrap().is_empty());
        assert!(payload(&[1], 64).is_err());
        assert!(payload(&[1, 0x62, 0], 64).is_err());
        assert!(payload(&[], 0).is_err());
    }

    #[test]
    fn bounded_wait_cancels_pending_future() {
        let start = Instant::now();
        let result = wait_until(std::future::pending::<()>(), start + Duration::from_millis(5));
        assert!(result.is_err());
        assert!(start.elapsed() < Duration::from_secs(1));
    }
}
