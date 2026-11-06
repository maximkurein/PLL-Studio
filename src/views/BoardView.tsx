import { useState } from "react";
import { CircuitBoard, ShieldAlert } from "lucide-react";
import { lockInfo, useSim, useStore } from "../lib/store";
import { fmtF } from "../lib/format";
import { Badge, Button, Card, Hint, PageHeader, cx } from "../components/ui";
import type { ViewId } from "../lib/types";

interface Spot {
  id: string;
  x: number;
  y: number;
  title: string;
  desc: string;
  go?: [ViewId, string?];
}

const SPOTS: Spot[] = [
  { id: "usb", x: 64, y: 120, title: "USB-разъём", desc: "Питание платы и связь с ПК через штатный USB-мост (Timing Commander). Плата поставляется с питанием от USB.", go: ["hardware"] },
  { id: "mcu", x: 180, y: 120, title: "USB-контроллер (мост USB→SPI)", desc: "Преобразует команды с ПК в SPI-кадры для 8V97051. Тип микросхемы определите сканером USB на вкладке «Подключение».", go: ["hardware"] },
  { id: "jp3", x: 180, y: 222, title: "JP3 — выбор питания", desc: "Положение USB — питание от USB (по умолчанию). Положение EXT — от внешнего источника 3.3 В через клеммы. Перед первым включением проверьте положение JP3." },
  { id: "pwr", x: 72, y: 430, title: "Клеммы внешнего питания", desc: "+3.3 В и GND для питания от лабораторного источника (меньше шумов, чем USB). Ограничьте ток источника ~400 мА." },
  { id: "ldo", x: 210, y: 410, title: "Стабилизаторы (LDO) и фильтры питания", desc: "Отдельные домены VDDA, VDD_CP, VDD_VCO, VDDD — шум питания ГУН напрямую превращается в фазовый шум.", go: ["hardware"] },
  { id: "tcxo", x: 340, y: 150, title: "TCXO 25 МГц", desc: "Термокомпенсированный кварцевый генератор — опора по умолчанию. Его фазовый шум внутри полосы петли умножается на 20·log(fVCO/25 МГц).", go: ["arch", "ref"] },
  { id: "j1", x: 340, y: 38, title: "SMA J1 — внешняя опора REF_IN", desc: "Вход внешнего опорного сигнала 5…310 МГц (например, 10/100 МГц от стандарта частоты). Переключение источника — на схеме архитектуры.", go: ["arch", "ref"] },
  { id: "chip", x: 500, y: 290, title: "8V97051 (VFQFN-48, 7×7 мм)", desc: "Сам синтезатор: PFD, накачка, ГУН 2.2–4.4 ГГц, Frac-N делитель, M0, выходы. Откройте интерактивную архитектуру, чтобы изучить каждый блок.", go: ["arch", "vco"] },
  { id: "lf", x: 628, y: 250, title: "Петлевой фильтр", desc: "RC-компоненты между CP_OUT и VTUNE. Их номиналы задают полосу петли — впишите реальные значения во вкладке «Петля ФАПЧ».", go: ["loop"] },
  { id: "outa", x: 846, y: 214, title: "SMA RF_OUTA", desc: "Прямой выход A (34.375 МГц – 4.4 ГГц, до +7 dBm). Подключайте к анализатору 50 Ом, желательно через аттенюатор 10 дБ.", go: ["arch", "outa"] },
  { id: "nouta", x: 846, y: 366, title: "SMA nRF_OUTA", desc: "Инверсный выход A. Неиспользуемый выход нагрузите на 50 Ом. Вместе с RF_OUTA — дифференциальный сигнал (+3 дБ мощности через балун).", go: ["arch", "outa"] },
  { id: "ld", x: 640, y: 436, title: "Светодиод LD", desc: "Горит при захвате PLL (вывод LD в режиме Digital Lock Detect). В приложении состояние дублируется индикатором в верхней панели.", go: ["arch", "ld"] },
  { id: "ce", x: 420, y: 452, title: "CE — перемычка/контроль", desc: "Chip Enable: 0 выключает кристалл. На плате управляется перемычкой или контроллером.", go: ["arch", "pins"] },
  { id: "spi", x: 300, y: 474, title: "Линии SPI и MUX_OUT", desc: "SCLK, SDI, nCS и MUX_OUT/SDO. Сюда можно подключить внешний SPI-мост (см. схему на вкладке «Подключение»).", go: ["hardware"] },
];

function Board({ sel, onSel }: { sel: string | null; onSel: (id: string) => void }) {
  const snap = useStore((s) => s.snap)!;
  const sim = useSim();
  const status = useStore((s) => s.status);
  const li = lockInfo(sim, status?.ld);
  const ldOn = li.tone === "ok";
  const outOn = sim ? sim.outputs_live : snap.derived.out_a_en && !snap.pins.muted;
  const pcb = "#0f3b2f",
    pcbEdge = "#1b5a47",
    copper = "#c8a45a",
    silk = "#e7efe9";
  const tcxo = snap.settings.ref_source === "tcxo";

  const sma = (x: number, y: number, active: boolean, vertical?: boolean) => (
    <g>
      <rect x={vertical ? x - 18 : x - 6} y={vertical ? y - 6 : y - 18} width={vertical ? 36 : 44} height={vertical ? 44 : 36} rx={4} fill="#b9bcc2" />
      <circle cx={vertical ? x : x + 16} cy={vertical ? y + 16 : y} r={13} fill="#d7d9de" stroke="#8d9097" />
      <circle cx={vertical ? x : x + 16} cy={vertical ? y + 16 : y} r={6} fill="#f2e6b8" stroke="#8d9097" />
      {active && <circle cx={vertical ? x : x + 16} cy={vertical ? y + 16 : y} r={18} fill="none" stroke="var(--rf)" strokeWidth={2} opacity={0.8} className="led-pulse" />}
    </g>
  );

  return (
    <svg viewBox="0 0 900 540" className="w-full h-auto select-none">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id="pcbdots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.9" fill="#2b6d58" />
        </pattern>
      </defs>
      <rect x={20} y={20} width={820} height={500} rx={18} fill={pcb} stroke={pcbEdge} strokeWidth={3} />
      <rect x={20} y={20} width={820} height={500} rx={18} fill="url(#pcbdots)" opacity={0.5} />
      {[
        [40, 40],
        [820, 40],
        [40, 500],
        [820, 500],
      ].map(([x, y]) => (
        <circle key={x + "-" + y} cx={x} cy={y} r={8} fill="#0a2a21" stroke={copper} strokeWidth={2} />
      ))}
      <text x={60} y={508} fontSize={13} fill={silk} fontWeight={700} letterSpacing={1}>
        8V9705x EVB · REV B
      </text>

      {/* traces */}
      <g stroke={copper} strokeWidth={2.4} fill="none" opacity={0.55}>
        <path d="M110 120 H160" />
        <path d="M210 130 V250 H300 V290 H455" />
        <path d="M210 140 V240 H290 V300 H455" />
        <path d="M340 175 V260 H455" opacity={tcxo ? 1 : 0.35} />
        <path d="M352 66 V100 H400 V270 H455" opacity={tcxo ? 0.35 : 1} />
        <path d="M545 270 H600" />
        <path d="M545 310 H600 V250" />
        <path d="M545 285 H760 V214 H830" strokeWidth={3.2} />
        <path d="M545 300 H760 V366 H830" strokeWidth={3.2} />
        <path d="M500 335 V436 H628" />
        <path d="M240 410 H300 V350 H470 V335" />
      </g>

      {/* USB */}
      <rect x={24} y={100} width={58} height={40} rx={5} fill="#9ea3ab" stroke="#6d727a" />
      <rect x={34} y={110} width={40} height={20} rx={3} fill="#2d3138" />
      {/* MCU */}
      <rect x={150} y={92} width={60} height={60} rx={4} fill="#1d2126" stroke="#444a52" />
      <text x={180} y={127} textAnchor="middle" fontSize={9} fill="#8b929c">
        USB MCU
      </text>
      {/* power LED */}
      <circle cx={120} cy={70} r={6} fill="#5be38f" filter="url(#glow)" />
      <text x={132} y={74} fontSize={9.5} fill={silk}>
        PWR
      </text>
      {/* JP3 */}
      <rect x={160} y={208} width={44} height={28} rx={3} fill="#151a1f" stroke={silk} strokeWidth={0.8} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={168 + i * 14} cy={222} r={3.5} fill={copper} />
      ))}
      <rect x={162} y={214} width={24} height={16} rx={2} fill="#1f62d8" />
      <text x={182} y={252} textAnchor="middle" fontSize={9.5} fill={silk}>
        JP3 USB|EXT
      </text>
      {/* power terminals */}
      <circle cx={60} cy={410} r={16} fill="#c43b3b" stroke="#7d1f1f" strokeWidth={2} />
      <circle cx={60} cy={460} r={16} fill="#222" stroke="#000" strokeWidth={2} />
      <text x={84} y={414} fontSize={10} fill={silk}>
        +3.3V
      </text>
      <text x={84} y={464} fontSize={10} fill={silk}>
        GND
      </text>
      {/* LDOs */}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={180 + i * 28} y={392} width={20} height={34} rx={2} fill="#1d2126" stroke="#444a52" />
      ))}
      {/* TCXO */}
      <rect x={312} y={130} width={56} height={42} rx={5} fill="#c9ccd3" stroke="#8d9097" />
      <text x={340} y={155} textAnchor="middle" fontSize={9.5} fill="#2d3138" fontWeight={700}>
        25.000
      </text>
      {tcxo && <rect x={308} y={126} width={64} height={50} rx={7} fill="none" stroke="var(--ref)" strokeWidth={2} opacity={0.9} />}
      {/* J1 SMA (top edge) */}
      {sma(352, 26, !tcxo, true)}
      <text x={378} y={60} fontSize={10} fill={silk}>
        J1 REF_IN
      </text>
      {/* chip */}
      <rect x={455} y={245} width={90} height={90} rx={6} fill="#181b20" stroke="#5b616b" />
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i} fill={copper}>
          <rect x={461 + i * 6.6} y={240} width={3} height={5} />
          <rect x={461 + i * 6.6} y={335} width={3} height={5} />
          <rect x={450} y={251 + i * 6.6} width={5} height={3} />
          <rect x={545} y={251 + i * 6.6} width={5} height={3} />
        </g>
      ))}
      <circle cx={465} cy={255} r={3} fill="#5b616b" />
      <text x={500} y={286} textAnchor="middle" fontSize={11} fill="#c7ccd4" fontWeight={700}>
        IDT
      </text>
      <text x={500} y={302} textAnchor="middle" fontSize={10} fill="#9aa1ab">
        8V97051
      </text>
      {/* loop filter parts */}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={600 + (i % 3) * 18} y={236 + Math.floor(i / 3) * 30} width={12} height={7} rx={1.5} fill={i % 2 ? "#a4743e" : "#2a2d33"} stroke="#555" strokeWidth={0.5} />
      ))}
      {/* RF SMAs */}
      {sma(806, 214, outOn)}
      {sma(806, 366, outOn)}
      <text x={792} y={186} textAnchor="end" fontSize={10.5} fill={silk}>
        RF_OUTA
      </text>
      <text x={792} y={404} textAnchor="end" fontSize={10.5} fill={silk}>
        nRF_OUTA
      </text>
      {/* LD LED */}
      <circle cx={640} cy={436} r={7} fill={ldOn ? "#5be38f" : "#244034"} filter={ldOn ? "url(#glow)" : undefined} />
      <text x={654} y={440} fontSize={9.5} fill={silk}>
        LD
      </text>
      {/* CE jumper */}
      <rect x={404} y={442} width={32} height={20} rx={3} fill="#151a1f" stroke={silk} strokeWidth={0.8} />
      <rect x={406} y={444} width={14} height={16} rx={2} fill={snap.pins.ce ? "#1f62d8" : "#555"} />
      <text x={420} y={478} textAnchor="middle" fontSize={9.5} fill={silk}>
        CE
      </text>
      {/* SPI header */}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={262 + i * 14} y={466} width={9} height={9} fill={copper} />
      ))}
      <text x={300} y={494} textAnchor="middle" fontSize={9.5} fill={silk}>
        SPI / MUX
      </text>

      {/* hotspots */}
      {SPOTS.map((s, i) => (
        <g key={s.id} className="cursor-pointer" onClick={() => onSel(s.id)}>
          <circle cx={s.x} cy={s.y} r={sel === s.id ? 15 : 11} fill={sel === s.id ? "var(--accent)" : "rgba(10,13,19,0.72)"} stroke="var(--accent)" strokeWidth={1.6} className="transition-all" />
          <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={sel === s.id ? "var(--accent-fg)" : "#fff"}>
            {i + 1}
          </text>
        </g>
      ))}
      {outOn && (
        <text x={830} y={300} textAnchor="middle" fontSize={11} fill="var(--rf)" fontWeight={600} transform="rotate(90 830 300)">
          {fmtF(snap.derived.f_out_a, 4)}
        </text>
      )}
    </svg>
  );
}

const CHECKLIST = [
  "JP3 в положении USB (питание от USB)",
  "Кабель USB подключён, светится PWR",
  "RF_OUTA → анализатор спектра через аттенюатор 10 дБ, nRF_OUTA нагружен на 50 Ом",
  "Подключение выбрано (симулятор или SPI-мост)",
  "Частота задана в планировщике, RF_OUTA включён",
  "Индикатор захвата зелёный, несущая видна на анализаторе",
];

export function BoardView() {
  const [sel, setSel] = useState<string>("chip");
  const go = useStore((s) => s.go);
  const [done, setDone] = useState<boolean[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("pll.checklist") ?? "[]");
    } catch {
      return [];
    }
  });
  const spot = SPOTS.find((s) => s.id === sel);
  const toggle = (i: number) => {
    const n = [...done];
    n[i] = !n[i];
    setDone(n);
    try {
      localStorage.setItem("pll.checklist", JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="max-w-[1600px]">
      <PageHeader icon={<CircuitBoard size={20} />} title="Оценочная плата 8V9705x EVB" subtitle="Схематичный вид платы REV B. Нажмите на номер, чтобы узнать назначение элемента. Расположение условное — сверяйтесь с вашей платой." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card bodyClass="!p-3">
          <Board sel={sel} onSel={setSel} />
        </Card>
        <div className="flex flex-col gap-4">
          {spot && (
            <Card title={`${SPOTS.indexOf(spot) + 1}. ${spot.title}`}>
              <p className="text-[12.5px] text-fg2 leading-relaxed">{spot.desc}</p>
              {spot.go && (
                <Button className="mt-3" size="sm" onClick={() => go(spot.go![0], spot.go![1])}>
                  Перейти
                </Button>
              )}
            </Card>
          )}
          <Card title="Первый запуск" subtitle={`${done.filter(Boolean).length} из ${CHECKLIST.length}`}>
            <div className="flex flex-col gap-1.5">
              {CHECKLIST.map((c, i) => (
                <label key={i} className="flex items-start gap-2 text-[12.5px] cursor-pointer">
                  <input type="checkbox" checked={!!done[i]} onChange={() => toggle(i)} className="mt-0.5 accent-[var(--accent)]" />
                  <span className={cx(done[i] ? "text-muted line-through" : "text-fg2")}>{c}</span>
                </label>
              ))}
            </div>
          </Card>
          <Card title="Безопасность" icon={<ShieldAlert size={15} />}>
            <ul className="text-[12px] text-fg2 leading-relaxed list-disc ml-4 space-y-1">
              <li>Питание 3.3 В ±5 %. Не подавайте больше 3.6 В на клеммы.</li>
              <li>Выходы — открытый сток: не подавайте постоянное напряжение на SMA RF_OUT.</li>
              <li>До +7 dBm на выходе: защищайте вход анализатора аттенюатором.</li>
              <li>Опора на J1: синус/КМОП, уровень в пределах питания, без постоянной составляющей при AC-связи.</li>
              <li>Работайте с антистатическим браслетом — входы ГУН и опоры чувствительны к ESD.</li>
            </ul>
            <div className="mt-2 flex gap-1.5">
              <Badge tone="muted">TCXO 25 МГц</Badge>
              <Badge tone="muted">RF_OUTB не выведен</Badge>
            </div>
          </Card>
          <Hint>Состояние элементов на рисунке живое: выбранная опора, перемычка CE, светодиод LD и активность выходов берутся из текущей конфигурации.</Hint>
        </div>
      </div>
    </div>
  );
}
