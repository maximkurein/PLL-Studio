import { Copy, ExternalLink, GitBranch, Info, ShieldCheck } from "lucide-react";
import { useStore } from "../lib/store";
import { copyText, isTauri, openUrl } from "../lib/api";
import { Badge, Button, Card, Hint, PageHeader, Row } from "../components/ui";

export function AboutView() {
  const app = useStore((s) => s.meta?.app);
  const snap = useStore((s) => s.snap);
  const toast = useStore((s) => s.toast);
  if (!app || !snap) return null;

  const open = async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      toast("err", `Не удалось открыть ссылку: ${String(error)}`);
    }
  };
  const clone = async (url: string) => {
    const command = `git clone ${url.replace(/\.git\/?$/, "").replace(/\/$/, "")}.git`;
    const copied = await copyText(command);
    toast(copied ? "ok" : "err", copied ? "Команда git clone скопирована" : "Не удалось скопировать команду: доступ к буферу обмена запрещён");
  };

  return (
    <div className="max-w-[1100px] space-y-4">
      <PageHeader title="О программе" subtitle="Версия, разработчик и исходный код" icon={<Info size={21} />} />
      <Card>
        <div className="flex flex-wrap items-center gap-5 py-2">
          <img src="/icon.svg" alt={`Иконка ${app.name}`} className="w-24 h-24 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-[27px] font-semibold tracking-tight">{app.name}</h2>
            <p className="text-[13px] text-muted mt-1">Версия {app.version} · от {app.release_date}</p>
            <p className="text-[16px] font-semibold text-accent mt-2">Разработчик {app.author}</p>
          </div>
        </div>
      </Card>
      <Card title="Сведения о приложении">
        <Row label="Лицензия"><span>{app.license} · © {app.release_date.slice(-4)} {app.author}</span></Row>
        <Row label="Режим запуска"><Badge tone="accent">{isTauri ? "Desktop · Tauri" : "Браузер · pll-server"}</Badge></Row>
        <Row label="Подключение"><span>{snap.link.name}</span><Badge tone={snap.link.kind === "sim" ? "muted" : "ok"}>{snap.link.kind === "sim" ? "Симулятор" : "Реальная плата"}</Badge></Row>
        <Row label="Интерфейс устройства"><span className="text-muted break-words">{snap.link.detail}</span></Row>
        <Row label="Состояние связи"><span className={snap.link_error ? "text-err" : "text-fg2"}>{snap.link_error ?? "Связь с движком установлена"}</span></Row>
      </Card>
      <Card title="Исходный код" icon={<GitBranch size={16} />} subtitle="Две копии одного проекта">
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { label: "GitHub", hint: "Основной репозиторий проекта", url: app.repository },
            { label: "Forgejo", hint: "Зеркало в локальной сети; нужен доступ к этой сети", url: app.mirror },
          ].map((repo) => (
            <div key={repo.label} className="rounded-xl border border-line bg-panel2 p-4 space-y-2">
              <h3 className="font-semibold text-[13px]">{repo.label}</h3>
              <p className="text-[11.5px] text-muted">{repo.hint}</p>
              <p className="text-[12px] num break-all select-text">{repo.url}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button icon={<ExternalLink size={13} />} onClick={() => void open(repo.url)} title={`Открыть ${repo.label} в браузере`}>Открыть</Button>
                <Button icon={<Copy size={13} />} onClick={() => void clone(repo.url)} title={`Копировать git clone для ${repo.label}`}>git clone</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Условия использования" icon={<ShieldCheck size={16} />}>
        <p className="text-[12.5px] text-fg2 leading-relaxed mb-3">Программа поставляется «как есть», без гарантий. Расчётные модели помогают изучать синтезатор; частоту, мощность и спектр проверяйте измерительными приборами.</p>
        <Hint tone="warn">Логика SPI — 3.3 В. Перед подключением внешнего SPI-мастера изолируйте штатный USB-контроллер EVB; два активных мастера на одной шине недопустимы. Сверяйте питание и перемычки с ревизией платы. Запись конфигурации может включить RF-выходы. Для readback по штатному USB нужна проводимость цепи R2.</Hint>
      </Card>
    </div>
  );
}
