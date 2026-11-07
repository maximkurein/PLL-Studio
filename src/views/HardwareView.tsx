import { useEffect, useState } from "react";
import { Cable, Cpu, Plug, RefreshCw, ScanSearch, Usb, Zap } from "lucide-react";
import { useStore } from "../lib/store";
import { fmtF } from "../lib/format";
import type { EvbUsbDevice, PortInfo, UsbDev } from "../lib/types";
import { Badge, Button, Card, FreqField, Hint, Led, NumField, PageHeader, Row, Segmented, Select, Slider } from "../components/ui";

const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, "0");

function Wiring() {
  const pins: [string, string, string][] = [
    ["SCLK", "SCK", "var(--ctl)"],
    ["SDI", "MOSI", "var(--ctl)"],
    ["nCS", "D10 (NCS)", "var(--ctl)"],
    ["MUX_OUT", "MISO", "var(--dig)"],
    ["CE", "D9", "var(--ok)"],
    ["MUTE", "D8", "var(--warn)"],
    ["LD", "D7", "var(--dig)"],
    ["GND", "GND", "var(--muted)"],
  ];
  return (
    <svg viewBox="0 0 520 300" className="w-full h-auto">
      <rect x={20} y={20} width={150} height={260} rx={12} fill="var(--panel-2)" stroke="var(--line-2)" />
      <text x={95} y={44} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--fg)">
        Плата 8V97051 EVB
      </text>
      <rect x={350} y={20} width={150} height={260} rx={12} fill="var(--panel-2)" stroke="var(--accent)" strokeOpacity={0.6} />
      <text x={425} y={44} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--fg)">
        SPI-мост 3.3 В
      </text>
      <text x={425} y={60} textAnchor="middle" fontSize={10} fill="var(--muted)">
        Nucleo / RP2040 / Arduino
      </text>
      {pins.map(([a, b, c], i) => {
        const y = 82 + i * 25;
        return (
          <g key={a}>
            <circle cx={170} cy={y} r={4} fill={c} />
            <circle cx={350} cy={y} r={4} fill={c} />
            <path d={`M174 ${y} C 260 ${y}, 260 ${y}, 346 ${y}`} stroke={c} strokeWidth={1.8} fill="none" />
            <text x={160} y={y + 4} textAnchor="end" fontSize={11} fill="var(--fg-2)" fontFamily="var(--font-mono)">
              {a}
            </text>
            <text x={360} y={y + 4} fontSize={11} fill="var(--fg-2)" fontFamily="var(--font-mono)">
              {b}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function HardwareView() {
  const snap = useStore((s) => s.snap)!;
  const status = useStore((s) => s.status);
  const call = useStore((s) => s.call);
  const setSettings = useStore((s) => s.setSettings);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [usb, setUsb] = useState<UsbDev[] | null>(null);
  const [port, setPort] = useState("");
  const [baud, setBaud] = useState(115200);
  const [evbDevices, setEvbDevices] = useState<EvbUsbDevice[] | null>(null);
  const [evbIndex, setEvbIndex] = useState("");
  const [evbBusy, setEvbBusy] = useState(false);
  const refreshEvb = async () => {
    setEvbBusy(true);
    try {
      const devices = await call<EvbUsbDevice[]>("list_evb_usb");
      if (devices) { setEvbDevices(devices); setEvbIndex(""); }
    } finally { setEvbBusy(false); }
  };
  const connectEvb = async () => {
    const device = evbIndex === "" ? undefined : evbDevices?.[Number(evbIndex)];
    if (!device) return;
    setEvbBusy(true);
    try { await call("connect", { kind: "evb_usb", device: device.selector }); }
    finally { setEvbBusy(false); }
  };

  const refresh = async () => {
    const p = await call<PortInfo[]>("list_ports", {}, true);
    if (p) {
      setPorts(p);
      if (!port && p.length) setPort(p[0].path);
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scan = async () => setUsb((await call<UsbDev[]>("scan_usb")) ?? []);
  const isSim = snap.link.kind === "sim";
  const ld = snap.link.caps.ld ? status?.ld : null;
  const maxMa = Math.max(...snap.power.domains.map((d) => d[1]), 1);

  return (
    <div className="max-w-[1500px]">
      <PageHeader
        icon={<Usb size={20} />}
        title="Подключение и железо"
        subtitle="Работайте с виртуальным кристаллом (точная модель регистров, калибровки и захвата) или с реальной платой через штатный USB EVB / внешний последовательный SPI-мост."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Текущее подключение" icon={<Plug size={15} />}>
          <div className="flex items-center gap-3 rounded-xl border border-line bg-panel2 px-4 py-3">
            <Led tone={snap.link_error ? "err" : "ok"} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{snap.link.name}</div>
              <div className="text-[11.5px] text-muted truncate">{snap.link_error ?? snap.link.detail}</div>
            </div>
            <div className="flex gap-1 flex-wrap justify-end">
              {Object.entries(snap.link.caps).map(([k, v]) => (
                <Badge key={k} tone={v ? "ok" : "muted"}>
                  {{ readback: "чтение", ld: "LD", ce: "CE", mute: "MUTE" }[k] ?? k}
                </Badge>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-accent/30 p-3">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold">
              <Usb size={14} className="text-accent" /> Штатный USB платы EVB
              <Badge tone="warn">экспериментальный</Badge>
            </div>
            <p className="text-[11.5px] text-muted mt-1 leading-relaxed">
              FT2232 → SC18IS602, Rev A. Внешний SPI-мост не нужен. Выберите именно плату EVB:
              одинаковый USB ID встречается у других устройств FT2232. Закройте Timing Commander.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Select className="flex-1 min-w-48" value={evbIndex} onChange={setEvbIndex}
                options={[{ value: "", label: "Выберите плату после поиска" }, ...(evbDevices ?? []).map((d, i) => ({
                  value: String(i), label: `${d.product ?? "FT2232"} · USB ${d.selector.bus}:${d.selector.address}${d.selector.serial ? ` · ${d.selector.serial}` : ""}`,
                }))]} />
              <Button size="sm" disabled={evbBusy} onClick={refreshEvb}>Найти EVB</Button>
              <Button size="sm" variant="primary" disabled={evbBusy || evbIndex === "" || snap.link.kind === "evb_usb"} onClick={connectEvb}>
                {evbBusy ? "Обмен…" : "Подключить USB"}
              </Button>
              {snap.link.kind === "evb_usb" && <Button size="sm" onClick={() => call("connect", { kind: "sim" })}>Отключить USB</Button>}
            </div>
            {evbDevices?.length === 0 && <p className="mt-2 text-[12px] text-muted">FT2232 (0403:6010) не найден. Подключите EVB к компьютеру, на котором запущен PLL Studio.</p>}
            <Hint>
              При подключении регистры PLL не записываются, авто-запись выключается. Проверьте частоту и нажмите «Записать», затем «Регистры» → «Прочитать все».
              CE/MUTE задаются JP2/JP1; LD проверяется на плате. Windows: нужен WinUSB для канала A.
              Для чтения требуется замкнутая цепь MUX_OUT → MISO: на схеме Rev A резистор R2 помечен NP.
            </Hint>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                <Cpu size={14} className="text-pfd" /> Симулятор 8V97051
              </div>
              <p className="text-[11.5px] text-muted mt-1 leading-relaxed">
                Двойная буферизация, калибровка ГУН, захват, readback, sticky-флаги, температура. Идеален для изучения и проверки конфигурации до записи в плату.
              </p>
              <Button className="mt-2" size="sm" variant={isSim ? "subtle" : "primary"} onClick={() => call("connect", { kind: "sim" })}>
                {isSim ? "Переподключить" : "Включить симулятор"}
              </Button>
            </div>
            <div className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                <Cable size={14} className="text-ok" /> Последовательный SPI-мост
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <Select
                  className="flex-1 min-w-0"
                  value={port}
                  onChange={setPort}
                  options={ports.length ? ports.map((p) => ({ value: p.path, label: `${p.path}${p.product ? " — " + p.product : ""}` })) : [{ value: "", label: "порты не найдены" }]}
                />
                <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={refresh} title="Обновить список" />
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <Select
                  value={baud}
                  onChange={setBaud}
                  options={[115200, 230400, 460800, 921600, 1000000, 2000000].map((b) => ({ value: b, label: `${b} бод` }))}
                />
                <Button size="sm" variant="primary" disabled={!port} onClick={() => call("connect", { kind: "serial", path: port, baud })}>
                  Подключить
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Управляющие выводы и опора" icon={<Zap size={15} />}>
          <Row label="CE (Chip Enable)">
            {snap.link.caps.ce ? <Segmented value={snap.pins.ce ? 1 : 0} onChange={(v) => call("set_pins", { ce: v === 1 })} options={[{ value: 1, label: "1 — работа" }, { value: 0, label: "0 — выкл" }]} /> : <span className="text-[12px] text-muted">JP2 — положение не считывается</span>}
          </Row>
          <Row label="MUTE (активный 0)">
            {snap.link.caps.mute ? <Segmented value={snap.pins.muted ? 1 : 0} onChange={(v) => call("set_pins", { muted: v === 1 })} options={[{ value: 0, label: "выходы активны" }, { value: 1, label: "заглушить" }]} /> : <span className="text-[12px] text-muted">JP1 / поля RF_OUTA_EN и RF_OUTB_EN</span>}
          </Row>
          <Row label="Вывод LD">
            <Led tone={ld == null ? "off" : ld ? "ok" : "err"} />
            <span className="text-[12px] text-fg2">{ld == null ? "не читается" : ld ? "1 — захват" : "0 — нет захвата"}</span>
          </Row>
          <Row label="Источник опоры">
            <Segmented value={snap.settings.ref_source} onChange={(v) => setSettings({ ref_source: v })} options={[{ value: "tcxo", label: "TCXO 25 МГц" }, { value: "sma", label: "SMA J1" }]} />
          </Row>
          {snap.settings.ref_source === "sma" && (
            <Row label="Частота опоры" hint="5…310 МГц (≤100 МГц с ×2)">
              <FreqField hz={snap.settings.ref_hz} onCommit={(v) => setSettings({ ref_hz: v })} width="w-32" />
            </Row>
          )}
          <Hint>Выбор опоры задаёт параметры расчёта. Для J1 требуется доработка платы: R20/R1/C3/R3/C4 по руководству EVB, стр. 11.</Hint>
          <Row label="RCP" hint="R5 = 4.7 кОм по схеме EVB Rev A">
            <NumField value={snap.settings.rcp_ohm} min={2700} max={10000} onCommit={(v) => setSettings({ rcp_ohm: v })} unit="Ом" width="w-16" />
          </Row>
          <Row label={`Окружающая ${snap.settings.ambient_c.toFixed(0)} °C`} hint="для оценки Tj">
            <Slider value={snap.settings.ambient_c} min={-40} max={85} onChange={(v) => setSettings({ ambient_c: v })} />
          </Row>
        </Card>

        <Card title="Сканер USB" icon={<ScanSearch size={15} />} subtitle="Определение моста на плате (FTDI, Cypress, Silicon Labs, MCP2210…) по VID:PID" actions={<Button size="sm" onClick={scan}>Сканировать</Button>}>
          {usb == null ? (
            <div className="text-[12px] text-muted">Подключите EVB по USB и нажмите «Сканировать».</div>
          ) : usb.length === 0 ? (
            <div className="text-[12px] text-muted">USB-устройства не найдены (или нет прав доступа).</div>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto scroll-thin">
              {usb.map((u, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 ${u.likely_bridge ? "border-accent/40 bg-accent/6" : "border-line"}`}>
                  <span className="font-mono text-[11.5px] text-fg">
                    {hex4(u.vid)}:{hex4(u.pid)}
                  </span>
                  <span className="text-[12px] text-fg2 truncate flex-1">{[u.manufacturer, u.product].filter(Boolean).join(" · ") || "—"}</span>
                  {u.hint && <Badge tone={u.likely_bridge ? "accent" : "muted"}>{u.hint}</Badge>}
                </div>
              ))}
            </div>
          )}
          <Hint>
            Штатный путь EVB Rev A: FTDI U5 → I²C → SC18IS602 U4 → SPI. Для подключения используйте «Штатный USB платы EVB» выше.
            Сканер читает только USB-дескрипторы; совпадение VID:PID не подтверждает модель платы.
          </Hint>
        </Card>

        <Card title="Схема подключения внешнего моста" icon={<Cable size={15} />} subtitle="Логика кристалла 1.8 В, входы толерантны к 3.3 В. Только 3.3-вольтовые платы!">
          <Wiring />
          <Hint tone="warn">
            Перед подключением внешнего моста изолируйте выходы U4 SC18IS602 от SCLK, SDI и CSB — иначе два ведущих устройства будут бороться за шину. JP1/JP2 управляют MUTE/CE, JP3 — питанием; это не перемычки изоляции SPI. Способ изоляции проверьте по схеме вашей ревизии.
          </Hint>
        </Card>

        <Card title="Потребление по доменам питания" subtitle={`Всего ${snap.power.total_ma.toFixed(0)} мА · ${snap.power.power_mw.toFixed(0)} мВт · Tj ≈ ${snap.power.tj_c.toFixed(0)} °C (θJA 34.3 °C/Вт)`}>
          <div className="flex flex-col gap-2">
            {snap.power.domains.map(([n, ma]) => (
              <div key={n} className="flex items-center gap-3 text-[12px]">
                <span className="w-28 shrink-0 font-mono text-fg2">{n}</span>
                <div className="flex-1 h-2.5 rounded-full bg-panel3 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(ma / maxMa) * 100}%`, background: "linear-gradient(90deg, var(--accent), var(--pfd))" }} />
                </div>
                <span className="w-16 text-right num">{ma.toFixed(1)} мА</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Протокол SPI-моста" subtitle="Текстовые команды по последовательному порту, 115200 бод, конец строки \\n">
          <div className="formula selectable">
            {`?            → PLLBRIDGE <версия>\nX 0032000A   → OK <MISO>        32-битный SPI-кадр (MSB first, mode 0)\nCE 0|1       → OK               вывод CE\nMUTE 0|1     → OK               уровень вывода MUTE (0 — заглушить)\nLD           → OK 0|1           чтение вывода LD\nSPI 1000000  → OK               частота SCLK, Гц (≤ 20 МГц)`}
          </div>
          <p className="text-[12px] text-muted">
            Готовый скетч: <span className="kbd">firmware/spi_bridge/spi_bridge.ino</span> (Arduino IDE / PlatformIO, платы с логикой 3.3 В). Опорная частота для симулятора: {fmtF(snap.settings.ref_hz, 3)}.
          </p>
        </Card>
      </div>
    </div>
  );
}
