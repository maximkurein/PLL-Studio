//! 8V97051 register map (datasheet rev. 2023-02-03, Tables 5A–12N).
//!
//! Every register is a 32-bit word shifted MSB-first. The three LSBs (D2:D0)
//! are the control bits = register address. Bit positions below were taken
//! from the "Bit Allocation" tables of the datasheet.

use serde::Serialize;
use std::collections::BTreeMap;

pub const NUM_REGS: usize = 8;
pub type Words = [u32; NUM_REGS];

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    /// Normal read/write configuration bits.
    Rw,
    /// Read-only status (ignored on write).
    Ro,
    /// Sticky status bit: set by hardware, cleared by writing 1.
    Sticky,
    /// Must always be written with the default value.
    Fixed,
}

#[derive(Clone, Debug, Serialize)]
pub struct FieldDef {
    pub name: &'static str,
    pub reg: usize,
    pub msb: u8,
    pub lsb: u8,
    pub access: Access,
    pub default: u32,
    /// Short human title (RU).
    pub title: &'static str,
    /// Explanation (RU).
    pub desc: &'static str,
    /// Enumerated values, if any.
    pub options: &'static [(u32, &'static str)],
    /// Block id in the architecture diagram.
    pub block: &'static str,
    /// Value takes effect only after the next write to Register 0.
    pub double_buffered: bool,
}

impl FieldDef {
    pub const fn width(&self) -> u8 {
        self.msb - self.lsb + 1
    }
    pub const fn mask(&self) -> u32 {
        let w = self.msb - self.lsb + 1;
        if w == 32 {
            u32::MAX
        } else {
            ((1u32 << w) - 1) << self.lsb
        }
    }
    pub const fn max(&self) -> u32 {
        let w = self.msb - self.lsb + 1;
        if w == 32 {
            u32::MAX
        } else {
            (1u32 << w) - 1
        }
    }
    pub fn get(&self, words: &Words) -> u32 {
        (words[self.reg] & self.mask()) >> self.lsb
    }
    pub fn set(&self, words: &mut Words, value: u32) {
        let m = self.mask();
        words[self.reg] = (words[self.reg] & !m) | ((value << self.lsb) & m);
    }
}

const NO: &[(u32, &str)] = &[];
const ON_OFF: &[(u32, &str)] = &[(0, "Выкл"), (1, "Вкл")];
const PWR: &[(u32, &str)] = &[(0, "−4 dBm"), (1, "−1 dBm"), (2, "+2 dBm"), (3, "+5 dBm")];

macro_rules! f {
    ($name:expr, $reg:expr, $msb:expr, $lsb:expr, $acc:ident, $def:expr, $block:expr, $db:expr, $opts:expr, $title:expr, $desc:expr) => {
        FieldDef {
            name: $name,
            reg: $reg,
            msb: $msb,
            lsb: $lsb,
            access: Access::$acc,
            default: $def,
            title: $title,
            desc: $desc,
            options: $opts,
            block: $block,
            double_buffered: $db,
        }
    };
}

pub static FIELDS: &[FieldDef] = &[
    // ───────────── Register 0 ─────────────
    f!("INT", 0, 30, 15, Rw, 100, "ndiv", false, NO, "INT — целая часть N",
        "16-битное целое значение делителя обратной связи: N = INT + FRAC/MOD. Значения 0…7 запрещены. Запись R0 запускает калибровку ГУН (если не отключена) и применяет все двойные буферы."),
    f!("FRAC", 0, 14, 3, Rw, 0, "ndiv", false, NO, "FRAC — числитель дроби",
        "Числитель дробной части (0 … MOD−1). FRAC = 0 переводит синтезатор в целочисленный режим (Integer-N). В 16-битном режиме дополняется 4 младшими битами EXT_FRAC (R7)."),
    // ───────────── Register 1 ─────────────
    f!("BAND_SEL_DISABLE", 1, 28, 28, Rw, 0, "vco", false,
        &[(0, "Калибровка ГУН при записи R0"), (1, "Держать текущий диапазон ГУН")],
        "Отключение выбора диапазона ГУН",
        "При 1 запись R0 не запускает калибровку диапазона и phase resync. Полезно для быстрых малых перестроек (<1 МГц) и пошаговой подстройки фазы."),
    f!("PHASE", 1, 26, 15, Rw, 1, "ndiv", true, NO, "PHASE — фаза выхода",
        "Сдвиг фазы выхода с шагом 360°/MOD. Рекомендуемое значение 1. Двойная буферизация: применяется после записи R0."),
    f!("MOD", 1, 14, 3, Rw, 2, "ndiv", true, NO, "MOD — модуль (знаменатель)",
        "Знаменатель дробной части, 2…4095 (12 бит) или 2…65535 (16 бит). Шаг сетки ГУН = fPFD/MOD. Двойная буферизация."),
    // ───────────── Register 2 ─────────────
    f!("NOISE_MODE", 2, 30, 29, Rw, 0, "sdm", false,
        &[(0, "Low Noise (dither выкл)"), (1, "Reserved"), (2, "Reserved"), (3, "Low Spur (dither вкл)")],
        "Режим шум / паразитные",
        "Low Noise — минимальный шум в полосе, но возможны дробные паразитные составляющие. Low Spur — включает dither ΣΔ-модулятора: паразитные размываются в широкополосный шум."),
    f!("MUX_OUT", 2, 28, 26, Rw, 0, "mux", false,
        &[(0, "Hi-Z"), (1, "VDDD (лог. 1)"), (2, "GNDD (лог. 0)"), (3, "Выход R-счётчика"), (4, "Выход N-счётчика"), (5, "Reserved"), (6, "Lock Detect"), (7, "SDO (чтение регистров)")],
        "MUX_OUT — мультиплексор выхода",
        "Выбор сигнала на выводе MUX_OUT: отладочные сигналы делителей, lock detect или SDO для 4-проводного SPI (обязательно для чтения регистров)."),
    f!("REF_DOUBLER", 2, 25, 25, Rw, 0, "doubler", true, ON_OFF, "Удвоитель опорной частоты ×2",
        "Удваивает частоту опорного сигнала перед R-делителем. Удвоение fPFD улучшает шум в полосе примерно на 3 дБ. REF_IN ≤ 100 МГц при включённом удвоителе."),
    f!("REF_DIV2", 2, 24, 24, Rw, 0, "rdiv2", true, ON_OFF, "Делитель опоры ÷2",
        "Делитель на 2 после R-счётчика. Даёт скважность 50% на входе PFD (полезно вместе с удвоителем)."),
    f!("R_COUNTER", 2, 23, 14, Rw, 1, "rdiv", true, NO, "R — делитель опоры",
        "10-битный делитель опорной частоты, 1…1023. fPFD = REF_IN·(1+D)/(R·(1+T))."),
    f!("DOUBLE_BUFFER", 2, 13, 13, Rw, 0, "logic", false, ON_OFF, "Двойная буферизация RF_DIV",
        "Если включено, значение делителя RF_DIV (R4) применяется только после записи R0 — синхронно с новым N."),
    f!("ICP", 2, 12, 9, Rw, 0, "cp", true,
        &[(0, "0.31 мА"), (1, "0.63 мА"), (2, "0.94 мА"), (3, "1.25 мА"), (4, "1.56 мА"), (5, "1.88 мА"), (6, "2.19 мА"), (7, "2.50 мА"),
          (8, "2.81 мА"), (9, "3.13 мА"), (10, "3.44 мА"), (11, "3.75 мА"), (12, "4.06 мА"), (13, "4.38 мА"), (14, "4.69 мА"), (15, "5.00 мА")],
        "ICP — ток накачки заряда",
        "Ток charge pump (при RCP = 5.1 кОм). Полоса петли пропорциональна Icp·Kvco·R/N — ток должен соответствовать рассчитанному петлевому фильтру."),
    f!("LDF", 2, 8, 8, Rw, 0, "ld", false, &[(0, "40 циклов (Frac-N)"), (1, "5 циклов (Int-N)")], "LDF — функция Lock Detect",
        "Сколько подряд циклов PFD фазовая ошибка должна быть меньше окна LDP, чтобы объявить захват."),
    f!("LDP", 2, 7, 7, Rw, 0, "ld", false, &[(0, "10 нс"), (1, "6 нс")], "LDP — точность Lock Detect",
        "Окно фазовой ошибки для детектора захвата. Должно быть меньше периода PFD; для высоких fPFD используйте LDP_EXT (R6)."),
    f!("PD_POLARITY", 2, 6, 6, Rw, 1, "pfd", false, &[(0, "Отрицательная"), (1, "Положительная")], "Полярность фазового детектора",
        "1 — для пассивного или неинвертирующего активного фильтра; 0 — для инвертирующего активного фильтра."),
    f!("POWER_DOWN", 2, 5, 5, Rw, 0, "logic", false, ON_OFF, "Программное выключение",
        "Сбрасывает счётчики, выключает ГУН, переводит CP в Hi-Z, отключает выходы и вход REF_IN. Регистры продолжают принимать данные."),
    f!("CP_HIGHZ", 2, 4, 4, Rw, 0, "cp", false, ON_OFF, "Charge pump в Hi-Z",
        "Переводит выход накачки заряда в третье состояние — петля размыкается, ГУН «плавает» (режим открытой петли)."),
    // ───────────── Register 3 ─────────────
    f!("BAND_SEL_CLK_MODE", 3, 23, 23, Rw, 0, "vco", false, &[(0, "Low (≤125 кГц)"), (1, "High (≤500 кГц)")], "Скорость логики выбора диапазона",
        "High ускоряет калибровку ГУН (рекомендуется для быстрого захвата и высоких fPFD); тогда BAND_SEL_DIV ≤ 254."),
    f!("CLK_DIV_MODE", 3, 16, 15, Rw, 0, "fastlock", false, &[(0, "Выкл"), (1, "Fast Lock"), (2, "Phase Resync"), (3, "Reserved")], "Режим 12-битного таймера",
        "Fast Lock — временно увеличивает Icp и замыкает FLSW для ускорения захвата. Phase Resync — синхронизирует фазу выхода с опорой через TSYNC = CLK_DIV·MOD·TPFD."),
    f!("CLK_DIV", 3, 14, 3, Rw, 1, "fastlock", false, NO, "CLK_DIV — значение таймера",
        "12-битный таймер (1…4095) для Fast Lock и Phase Resync. TSYNC = CLK_DIV × MOD × TPFD должен превышать время захвата."),
    // ───────────── Register 4 ─────────────
    f!("FEEDBACK_SEL", 4, 23, 23, Rw, 1, "fbmux", false, &[(0, "С выхода ÷M0 (divided)"), (1, "С ГУН (fundamental)")], "Источник обратной связи",
        "Fundamental — N-делитель тактируется от ГУН (лучший шум). Divided — от выхода делителя M0: крупнее шаг фазы, но хуже шум в дробном режиме."),
    f!("RF_DIV", 4, 22, 20, Rw, 0, "m0", false,
        &[(0, "÷1"), (1, "÷2"), (2, "÷4"), (3, "÷8"), (4, "÷16"), (5, "÷32"), (6, "÷64"), (7, "Reserved")],
        "RF_DIV — выходной делитель M0",
        "Делит частоту ГУН (2.2–4.4 ГГц) для получения выходов до 34.375 МГц. Каждый шаг деления улучшает фазовый шум на 6 дБ."),
    f!("BAND_SEL_DIV", 4, 19, 12, Rw, 1, "vco", false, NO, "Делитель такта выбора диапазона",
        "Делит выход R-счётчика (fPFD) до 125…500 кГц для логики калибровки ГУН. Расширяется 4 старшими битами EXT_BAND_SEL_DIV (R6)."),
    f!("VCO_POWER_DOWN", 4, 11, 11, Rw, 0, "vco", false, &[(0, "ГУН включён"), (1, "ГУН выключен")], "Выключение ГУН", "Отключает питание ядра ГУН."),
    f!("MTLD", 4, 10, 10, Rw, 0, "outa", false, ON_OFF, "MTLD — тишина до захвата",
        "Mute Till Lock Detect: выходы отключены, пока PLL не захвачена — на выходе не появится «гуляющая» частота при перестройке."),
    f!("RF_OUTB_SEL", 4, 9, 9, Rw, 0, "outb", false, &[(0, "Делённый (÷M0)"), (1, "Fundamental (ГУН)")], "Источник RF_OUTB",
        "RF_OUTB может выдавать ту же частоту, что RF_OUTA (fVCO/M0), или прямую частоту ГУН."),
    f!("RF_OUTB_EN", 4, 8, 8, Rw, 0, "outb", false, ON_OFF, "Включение RF_OUTB", "Включает дифференциальный выход B (RF_OUTA тоже должен быть включён). На плате EVB выход B не выведен на разъёмы."),
    f!("RF_OUTB_PWR", 4, 7, 6, Rw, 2, "outb", false, PWR, "Мощность RF_OUTB", "Выходная мощность B; с RF_OUTB_HI_PWR=1 шкала смещается: +2/+5/+6/+7 dBm."),
    f!("RF_OUTA_EN", 4, 5, 5, Rw, 0, "outa", false, ON_OFF, "Включение RF_OUTA", "Включает основной дифференциальный выход A (на EVB — SMA RF_OUTA / nRF_OUTA). Отключение A отключает и B."),
    f!("RF_OUTA_PWR", 4, 4, 3, Rw, 2, "outa", false, PWR, "Мощность RF_OUTA", "Выходная мощность A; с RF_OUTA_HI_PWR=1 шкала смещается: +2/+5/+6/+7 dBm."),
    // ───────────── Register 5 ─────────────
    f!("LD_PIN_MODE", 5, 23, 22, Rw, 1, "ld", false, &[(0, "Low"), (1, "Digital Lock Detect"), (2, "Low"), (3, "High")], "Режим вывода LD",
        "Что выдаётся на вывод LD (светодиод захвата на плате)."),
    f!("R5_RESERVED_11", 5, 20, 19, Fixed, 3, "logic", false, NO, "Зарезервировано (= 11)", "Биты D20:D19 регистра 5 должны быть записаны единицами."),
    // ───────────── Register 6 (extended) ─────────────
    f!("DIG_LOCK", 6, 31, 31, Ro, 0, "ld", false, &[(0, "Нет захвата"), (1, "Захват")], "Digital Lock (только чтение)",
        "Состояние цифрового детектора захвата согласно LDF/LDP."),
    f!("BAND_SEL_DONE", 6, 30, 30, Ro, 0, "vco", false, &[(0, "Идёт"), (1, "Завершён")], "Выбор диапазона завершён (только чтение)",
        "1 — автокалибровка диапазона ГУН завершена."),
    f!("LDP_EXT", 6, 27, 26, Rw, 0, "ld", false, NO, "LDP_EXT — расширенная точность LD",
        "Вместе с LDP задаёт окно Lock Detect: 00→10/6 нс, 01→3 нс, 10→4/4.5 нс, 11→1.5 нс. Нужен для fPFD выше ~100 МГц."),
    f!("RF_OUTB_HI_PWR", 6, 25, 25, Rw, 0, "outb", false, ON_OFF, "RF_OUTB High Power", "Дополнительный бит мощности выхода B (шкала +2…+7 dBm)."),
    f!("RF_OUTA_HI_PWR", 6, 24, 24, Rw, 0, "outa", false, ON_OFF, "RF_OUTA High Power", "Дополнительный бит мощности выхода A (шкала +2…+7 dBm)."),
    f!("SDM_ORDER", 6, 23, 22, Rw, 3, "sdm", false, &[(0, "Выкл (Integer)"), (1, "1-й порядок"), (2, "2-й порядок"), (3, "3-й порядок")], "Порядок ΣΔ-модулятора",
        "Порядок сигма-дельта модулятора дробного делителя. Выше порядок — шум квантования сильнее вытеснен на высокие частоты (за полосу петли)."),
    f!("DITHER_GAIN", 6, 21, 21, Rw, 0, "sdm", false, &[(0, "LSB (рекоменд.)"), (1, "LSB×4")], "Усиление dither", "Амплитуда псевдослучайного dither в режиме Low Spur."),
    f!("SHAPE_DITHER_EN", 6, 20, 20, Rw, 1, "sdm", false, ON_OFF, "Формирование спектра dither", "Noise-shaping для dither — вытесняет его шум из полосы петли."),
    f!("SDM_TYPE", 6, 19, 18, Rw, 1, "sdm", false, &[(0, "Reserved"), (1, "SSMF-II"), (2, "SSMF-I"), (3, "SSMF-B")], "Тип ΣΔ-модулятора", "Архитектура многокаскадного (MASH-подобного) модулятора."),
    f!("BAND_SEL_ACC", 6, 17, 16, Rw, 0, "vco", false, &[(0, "1 цикл"), (1, "2 цикла"), (2, "4 цикла"), (3, "Reserved")], "Точность выбора диапазона",
        "Сколько тактов логики выбора диапазона тратится на каждое сравнение. Больше — точнее, но дольше калибровка."),
    f!("R6_D7", 6, 7, 7, Fixed, 0, "logic", false, NO, "Зарезервировано (= 0)", "Бит D7 регистра 6 должен быть 0."),
    f!("EXT_BAND_SEL_DIV", 6, 6, 3, Rw, 0, "vco", false, NO, "EXT_BAND_SEL_DIV — старшие биты",
        "4 старших бита делителя такта калибровки: итог = BAND_SEL_DIV + 256·EXT. Нужны при fPFD > 125 МГц."),
    // ───────────── Register 7 (extended / instruction) ─────────────
    f!("LOSS_DIG_LOCK", 7, 31, 31, Sticky, 0, "ld", false, NO, "Потеря цифрового захвата (sticky)",
        "1 — с момента последнего сброса был срыв захвата. Сбрасывается записью 1."),
    f!("LOSS_ANLG_LOCK", 7, 30, 30, Sticky, 0, "vco", false, NO, "Был выбор диапазона (sticky)",
        "1 — с момента сброса происходила перекалибровка диапазона ГУН. Сбрасывается записью 1."),
    f!("SPI_ERROR", 7, 29, 29, Sticky, 0, "spi", false, NO, "Ошибка SPI (sticky)",
        "1 — был SPI-цикл с числом тактов ≠ 32. Сбрасывается записью 1."),
    f!("REV_ID", 7, 27, 25, Ro, 1, "logic", false, NO, "Ревизия кристалла (RO)", "Идентификатор ревизии, по умолчанию 001."),
    f!("DEV_ID", 7, 24, 21, Ro, 6, "logic", false, NO, "ID устройства (RO)", "Идентификатор устройства, по умолчанию 0110."),
    f!("RES_16BIT", 7, 20, 20, Rw, 0, "ndiv", false, &[(0, "12 бит"), (1, "16 бит")], "Разрешение FRAC/MOD/PHASE",
        "1 — 16-битный режим: FRAC, MOD и PHASE дополняются 4 младшими битами из R7 (EXT_*). Шаг сетки до fPFD/65535."),
    f!("EXT_PHASE", 7, 19, 16, Rw, 0, "ndiv", false, NO, "EXT_PHASE — младшие биты PHASE", "4 LSB фазы в 16-битном режиме: PHASE16 = PHASE·16 + EXT_PHASE."),
    f!("EXT_MOD", 7, 15, 12, Rw, 0, "ndiv", false, NO, "EXT_MOD — младшие биты MOD", "4 LSB модуля в 16-битном режиме: MOD16 = MOD·16 + EXT_MOD."),
    f!("EXT_FRAC", 7, 11, 8, Rw, 0, "ndiv", false, NO, "EXT_FRAC — младшие биты FRAC", "4 LSB числителя в 16-битном режиме: FRAC16 = FRAC·16 + EXT_FRAC."),
    f!("SCLKE", 7, 7, 7, Rw, 1, "spi", false, &[(0, "SDO по фронту SCLK"), (1, "SDO по спаду SCLK")], "Фронт выдачи SDO",
        "1 (по умолчанию) — бит выдаётся по спаду SCLK, мастер читает по фронту (SPI mode 0)."),
    f!("READBACK_ADDR", 7, 6, 4, Rw, 0, "spi", false,
        &[(0, "R0"), (1, "R1"), (2, "R2"), (3, "R3"), (4, "R4"), (5, "R5"), (6, "R6"), (7, "R7")],
        "Адрес чтения", "Номер регистра, который будет выдан на SDO в следующем 32-тактовом цикле."),
    f!("SPI_R_WN", 7, 3, 3, Rw, 0, "spi", false, &[(0, "WRITE"), (1, "READ")], "Запрос чтения",
        "1 — следующий SPI-цикл выдаст регистр READBACK_ADDR на SDO. Бит самосбрасывается."),
];

pub fn field(name: &str) -> Option<&'static FieldDef> {
    FIELDS.iter().find(|f| f.name == name)
}

/// Mask of bits that are not described by any field (reserved/unused) per register.
pub fn defined_mask(reg: usize) -> u32 {
    let mut m = 0x7u32; // control bits
    for f in FIELDS.iter().filter(|f| f.reg == reg) {
        m |= f.mask();
    }
    m
}

/// Bits that must never be written as 1 by the host (status / sticky / RO).
pub fn status_mask(reg: usize) -> u32 {
    FIELDS
        .iter()
        .filter(|f| f.reg == reg && matches!(f.access, Access::Ro | Access::Sticky))
        .fold(0, |m, f| m | f.mask())
}

/// Datasheet power-up defaults (writable configuration only; status bits zero).
pub fn defaults() -> Words {
    let mut w: Words = [0; NUM_REGS];
    for (i, word) in w.iter_mut().enumerate() {
        *word = i as u32;
    }
    for f in FIELDS.iter().filter(|f| !matches!(f.access, Access::Ro | Access::Sticky)) {
        f.set(&mut w, f.default);
    }
    w
}

/// Sensible start-up preset for the EVB (25 MHz TCXO): datasheet defaults
/// plus a legal band-select clock (500 kHz), integer-mode lock detect,
/// MUX_OUT = SDO (enables readback), ICP = 2.5 mA and RF_OUTA enabled → 2.5 GHz, +2 dBm.
pub fn starter() -> Words {
    let mut w = defaults();
    set(&mut w, "BAND_SEL_DIV", 50);
    set(&mut w, "BAND_SEL_CLK_MODE", 1);
    set(&mut w, "LDF", 1);
    set(&mut w, "MUX_OUT", 7);
    set(&mut w, "RF_OUTA_EN", 1);
    set(&mut w, "ICP", 7); // 2.5 mA — matches the default loop filter
    w
}

/// Normalise a word before sending it to the chip: force control bits,
/// clear RO/sticky bits, force fixed bits.
pub fn sanitize(reg: usize, word: u32) -> u32 {
    let mut w = [0u32; NUM_REGS];
    w[reg] = (word & !0x7 & !status_mask(reg)) | reg as u32;
    for f in FIELDS.iter().filter(|f| f.reg == reg && f.access == Access::Fixed) {
        f.set(&mut w, f.default);
    }
    // Clear bits that are reserved/unused.
    w[reg] & defined_mask(reg)
}

pub fn decode(words: &Words) -> BTreeMap<String, u32> {
    FIELDS.iter().map(|f| (f.name.to_string(), f.get(words))).collect()
}

pub fn get(words: &Words, name: &str) -> u32 {
    field(name).map(|f| f.get(words)).unwrap_or(0)
}

pub fn set(words: &mut Words, name: &str, value: u32) -> bool {
    match field(name) {
        Some(f) if value <= f.max() => {
            f.set(words, value);
            true
        }
        _ => false,
    }
}

/// Effective (12- or 16-bit) FRAC / MOD / PHASE values.
pub fn frac_mod_phase(words: &Words) -> (u32, u32, u32, bool) {
    let hi = get(words, "RES_16BIT") == 1;
    let (frac, m, ph) = (get(words, "FRAC"), get(words, "MOD"), get(words, "PHASE"));
    if hi {
        (
            frac << 4 | get(words, "EXT_FRAC"),
            m << 4 | get(words, "EXT_MOD"),
            ph << 4 | get(words, "EXT_PHASE"),
            true,
        )
    } else {
        (frac, m, ph, false)
    }
}

/// Write effective FRAC/MOD/PHASE, splitting them into the 12+4 bit fields.
pub fn set_frac_mod_phase(words: &mut Words, frac: u32, modulus: u32, phase: u32, hi_res: bool) {
    if hi_res {
        set(words, "RES_16BIT", 1);
        set(words, "FRAC", (frac >> 4) & 0xFFF);
        set(words, "EXT_FRAC", frac & 0xF);
        set(words, "MOD", (modulus >> 4) & 0xFFF);
        set(words, "EXT_MOD", modulus & 0xF);
        set(words, "PHASE", (phase >> 4) & 0xFFF);
        set(words, "EXT_PHASE", phase & 0xF);
    } else {
        set(words, "RES_16BIT", 0);
        set(words, "FRAC", frac & 0xFFF);
        set(words, "MOD", modulus & 0xFFF);
        set(words, "PHASE", phase & 0xFFF);
        set(words, "EXT_FRAC", 0);
        set(words, "EXT_MOD", 0);
        set(words, "EXT_PHASE", 0);
    }
}

/// Charge pump current in amps for code 0..15 (datasheet table, RCP = 5.1 kΩ).
pub fn icp_amps(code: u32, rcp_ohm: f64) -> f64 {
    let base = 0.3125e-3 * (code as f64 + 1.0);
    base * 5100.0 / rcp_ohm.max(1.0)
}

pub fn rf_div_value(code: u32) -> u32 {
    if code <= 6 {
        1 << code
    } else {
        64
    }
}

/// Output power in dBm for (pwr code, hi-power bit).
pub fn out_power_dbm(code: u32, hi: bool) -> f64 {
    match (hi, code) {
        (false, 0) => -4.0,
        (false, 1) => -1.0,
        (false, 2) => 2.0,
        (false, _) => 5.0,
        (true, 0) => 2.0,
        (true, 1) => 5.0,
        (true, 2) => 6.0,
        (true, _) => 7.0,
    }
}

/// Lock-detect window in ns from LDP and LDP_EXT (Table 4A).
pub fn ld_window_ns(ldp: u32, ldp_ext: u32) -> f64 {
    match (ldp_ext, ldp) {
        (0, 0) => 10.0,
        (0, _) => 6.0,
        (1, _) => 3.0,
        (2, 0) => 4.0,
        (2, _) => 4.5,
        _ => 1.5,
    }
}

/// All (ldp, ldp_ext, window_ns) combinations, sorted by window descending.
pub fn ld_window_options() -> Vec<(u32, u32, f64)> {
    let mut v = vec![(0, 0, 10.0), (1, 0, 6.0), (1, 2, 4.5), (0, 2, 4.0), (0, 1, 3.0), (0, 3, 1.5)];
    v.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_datasheet() {
        let d = defaults();
        assert_eq!(d[0], 100 << 15);
        assert_eq!(d[1], (1 << 15) | (2 << 3) | 1);
        assert_eq!(d[2], (1 << 6) | (1 << 14) | 2);
        assert_eq!(d[3], (1 << 3) | 3);
        assert_eq!(d[4], 0x0080_1094);
        assert_eq!(d[5], 0x0058_0005);
        assert_eq!(d[6], 0x00D4_0006);
        assert_eq!(d[7], 0x0000_0087);
    }

    #[test]
    fn fields_do_not_overlap() {
        for r in 0..NUM_REGS {
            let mut used = 0x7u32;
            for f in FIELDS.iter().filter(|f| f.reg == r) {
                assert_eq!(used & f.mask(), 0, "overlap in R{} field {}", r, f.name);
                used |= f.mask();
            }
        }
    }

    #[test]
    fn sixteen_bit_split() {
        let mut w = defaults();
        set_frac_mod_phase(&mut w, 40_001, 65_521, 17, true);
        assert_eq!(frac_mod_phase(&w), (40_001, 65_521, 17, true));
    }

    #[test]
    fn sanitize_clears_status() {
        let w = sanitize(7, 0xFFFF_FFFF);
        assert_eq!(w & (7 << 29), 0);
        assert_eq!(w & 7, 7);
        let w5 = sanitize(5, 0);
        assert_eq!(w5, (3 << 19) | 5);
    }
}
