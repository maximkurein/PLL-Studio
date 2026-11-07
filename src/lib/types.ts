export type Access = "rw" | "ro" | "sticky" | "fixed";

export interface FieldDef {
  name: string;
  reg: number;
  msb: number;
  lsb: number;
  access: Access;
  default: number;
  title: string;
  desc: string;
  options: [number, string][];
  block: string;
  double_buffered: boolean;
}

export interface Meta {
  fields: FieldDef[];
  defaults: number[];
  version: string;
}

export interface Issue {
  level: "error" | "warn" | "info";
  block: string;
  msg: string;
}

export interface Derived {
  f_ref: number;
  f_doubled: number;
  f_r: number;
  f_pfd: number;
  t_pfd_ns: number;
  r: number;
  doubler: boolean;
  div2: boolean;
  int: number;
  frac: number;
  modulus: number;
  phase: number;
  hi_res: boolean;
  n: number;
  integer_mode: boolean;
  sdm_order: number;
  f_vco: number;
  vco_core: number;
  m0: number;
  fb_fundamental: boolean;
  n_loop: number;
  f_div_out: number;
  f_out_a: number;
  f_out_b: number;
  out_a_en: boolean;
  out_b_en: boolean;
  pwr_a_dbm: number;
  pwr_b_dbm: number;
  band_sel_div: number;
  f_band_sel: number;
  channel_step_hz: number;
  phase_deg: number;
  phase_step_deg: number;
  icp_ma: number;
  ld_window_ns: number;
  ld_cycles: number;
  t_sync_s: number;
  frac_spur_step_hz: number;
  ibs_offset_hz: number | null;
  inband_floor_dbc: number;
  issues: Issue[];
}

export interface LoopFilter {
  order: number;
  c1: number;
  c2: number;
  r2: number;
  r3: number;
  c3: number;
}

export interface Settings {
  ref_hz: number;
  ref_source: "tcxo" | "sma";
  rcp_ohm: number;
  kvco_hz_v: number;
  loop_filter: LoopFilter;
  ref_noise: [number, number][];
  ambient_c: number;
  lock_tol_hz: number;
  jitter_f1: number;
  jitter_f2: number;
  residual_hz: number;
}

export interface LinkInfo {
  kind: "sim" | "serial" | "evb_usb" | string;
  name: string;
  detail: string;
  caps: { readback: boolean; ld: boolean; ce: boolean; mute: boolean };
}

export interface EvbUsbDevice {
  selector: { bus: number; address: number; serial: string | null };
  product: string | null;
  manufacturer: string | null;
  device_version: number;
}

export interface SimStatus {
  state: "power_down" | "calibrating" | "settling" | "locked" | "unlocked";
  reason: string | null;
  locked: boolean;
  ld_pin: boolean;
  mux_level: boolean | null;
  vtune: number;
  vco_core: number;
  sub_band: number;
  f_vco_now: number;
  f_out_now: number;
  since_write_us: number;
  band_select_us: number;
  lock_time_us: number | null;
  settle_us: number | null;
  outputs_live: boolean;
  temp_c: number;
  cal_temp_c: number;
  band_sel_done: boolean;
  loss_dig_lock: boolean;
  loss_anlg_lock: boolean;
  spi_error: boolean;
  ce: boolean;
  mute_pin_low: boolean;
}

export interface PowerEstimate {
  domains: [string, number][];
  total_ma: number;
  power_mw: number;
  tj_c: number;
  ambient_c: number;
}

export interface Snapshot {
  regs: number[];
  desired: number[];
  dev_regs: number[] | null;
  dirty: boolean[];
  fields: Record<string, number>;
  derived: Derived;
  settings: Settings;
  link: LinkInfo;
  link_error: string | null;
  auto_apply: boolean;
  pins: { ce: boolean; muted: boolean };
  power: PowerEstimate;
  log_head: number;
  readback: { words: number[]; valid: boolean[]; matches: boolean[] } | null;
  pending_db: string[];
  loop: { fc_hz: number; pm_deg: number; stable: boolean };
  sim: SimStatus | null;
}

export interface Status {
  sim: SimStatus | null;
  ld: boolean | null;
  log_head: number;
  link_error: string | null;
}

export interface Txn {
  id: number;
  t_ms: number;
  op: "write" | "read" | "raw" | "note";
  reg: number | null;
  mosi: number | null;
  miso: number | null;
  changes: [string, number, number][];
  note: string;
  ok: boolean;
}

export interface Candidate {
  r: number;
  doubler: boolean;
  div2: boolean;
  f_pfd: number;
  int: number;
  frac: number;
  modulus: number;
  hi_res: boolean;
  m0: number;
  f_vco: number;
  f_out: number;
  error_hz: number;
  integer_mode: boolean;
  inband_dbc: number;
  ibs_offset_hz: number | null;
  frac_spur_step_hz: number;
  score: number;
  notes: string[];
  fields: Record<string, number>;
}

export interface PlanResult {
  m0: number;
  f_vco_target: number;
  candidates: Candidate[];
  error: string | null;
}

export interface LoopAnalysis {
  f: number[];
  ol_mag_db: number[];
  ol_phase_deg: number[];
  cl_mag_db: number[];
  err_mag_db: number[];
  fc_hz: number;
  pm_deg: number;
  f3db_hz: number;
  peaking_db: number;
  zero_hz: number;
  pole1_hz: number;
  pole2_hz: number | null;
  stable: boolean;
}

export interface Transient {
  t_us: number[];
  f_err_hz: number[];
  vtune_dev_mv: number[];
  phase_err_deg: number[];
  settle_s: number | null;
  ld_s: number | null;
  cycle_slips: number;
}

export interface LoopParams {
  icp_a: number;
  kvco_hz_v: number;
  n: number;
  f_pfd: number;
}

export interface Spur {
  offset_hz: number;
  level_dbc: number;
  kind: "pfd" | "ibs" | "frac";
  label: string;
}

export interface NoiseResult {
  f: number[];
  total: number[];
  vco: number[];
  pll: number[];
  reference: number[];
  sdm: number[];
  floor: number[];
  f_out: number;
  f1: number;
  f2: number;
  jitter_fs: number;
  phase_err_deg: number;
  integrated_dbc: number;
  spurs: Spur[];
  marks: [number, number][];
}

export interface Spectrum {
  f: number[];
  dbm: number[];
  center_hz: number;
  span_hz: number;
  rbw_hz: number;
  carrier_dbm: number;
  markers: [number, number, string][];
}

export interface PortInfo {
  path: string;
  kind: string;
  vid: number | null;
  pid: number | null;
  manufacturer: string | null;
  product: string | null;
  serial: string | null;
}

export interface UsbDev {
  vid: number;
  pid: number;
  manufacturer: string | null;
  product: string | null;
  serial: string | null;
  bus: number;
  address: number;
  hint: string | null;
  likely_bridge: boolean;
}

export type ViewId = "arch" | "board" | "planner" | "registers" | "loop" | "noise" | "lab" | "hardware" | "learn";
