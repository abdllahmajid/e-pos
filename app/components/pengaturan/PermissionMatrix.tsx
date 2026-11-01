"use client";

// app/components/pengaturan/PermissionMatrix.tsx
// ── BARU (migration 038, "izin per user") ── Matriks hak akses modul (toggle)
// + modal "Tambah Akses Modul". Diadaptasi dari aplikasi Monitoring Konveksi
// (settings/PermissionMatrix.tsx) dan menggantikan checklist per role di
// PengaturanRoleTab.tsx yang lama. Logika izinnya ada di
// lib/pos/permissionModules.ts (murni, tanpa React).
//
// Satu baris = satu modul yang SUDAH punya akses. Modul tanpa akses tidak
// tampil; ditambahkan lewat "Tambah Akses Modul", dicabut lewat ikon sampah.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Layers, Trash2, X } from "lucide-react";
import {
  PERM_COLUMNS,
  MODULE_DEFS,
  getField,
  grantedModules,
  revokeModule,
  setField,
  type CanGrant,
  type InitialGrant,
  type ModuleDef,
  type PermColumn,
  type PermKey,
  type UserPermissions,
} from "@/lib/pos/permissionModules";

// ─── Switch ──────────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  disabled,
  title,
  label,
}: {
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
  title?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-lco-teal focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-950 ${
        checked ? "bg-lco-green" : "bg-zinc-200 dark:bg-zinc-700"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

const COLUMN_HEAD: Record<PermColumn, string> = {
  create: "Tambah",
  edit: "Ubah",
  delete: "Hapus",
};

const thCls =
  "px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800";

// ─── Matriks ─────────────────────────────────────────────────────────────────

export function PermissionMatrix({
  permissions,
  onChange,
  allGranted = false,
  readOnly = false,
  canGrant,
}: {
  permissions: UserPermissions;
  onChange: (next: UserPermissions) => void;
  /** Super Admin: semua modul & izin aktif otomatis, tidak bisa diubah. */
  allGranted?: boolean;
  /** Hanya dibaca (melihat izin akun sendiri / akun yang tidak boleh diubah). */
  readOnly?: boolean;
  /** Boleh MENYALAKAN izin ini? false → toggle mati dibekukan (mematikan selalu boleh). */
  canGrant?: CanGrant;
}) {
  const rows: ModuleDef[] = allGranted ? MODULE_DEFS : grantedModules(permissions);

  const reasonFor = (key: PermKey, field: string, current: boolean): string | undefined => {
    if (allGranted) return "Super Admin selalu punya akses ini";
    if (readOnly) return "Izin akun ini tidak bisa Anda ubah";
    if (!current && canGrant && !canGrant(key, field)) {
      return "Anda tidak punya izin ini, jadi tidak bisa memberikannya";
    }
    return undefined;
  };

  if (rows.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <Layers className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
        <p className="mt-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Belum ada akses modul</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Klik “Tambah Akses Modul” untuk memberi akses ke modul tertentu.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="bg-zinc-50 dark:bg-zinc-900">
            <th className={`${thCls} w-[40%] !text-left`}>Modul</th>
            {PERM_COLUMNS.map((c) => (
              <th key={c} className={thCls}>
                {COLUMN_HEAD[c]}
              </th>
            ))}
            <th className={thCls}>Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((d) => {
            const Icon = d.icon;
            return (
              <tr key={d.key} className="transition-colors duration-150 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/60">
                <td className="px-3 py-3 align-middle">
                  <span className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
                    {d.label}
                  </span>
                  {d.extras?.map((x) => {
                    const cur = allGranted || getField(permissions, d.key, x.field);
                    const why = reasonFor(d.key, x.field, cur);
                    return (
                      <label
                        key={x.field}
                        title={why ?? x.hint}
                        className={`mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 ${
                          why ? "cursor-not-allowed" : "cursor-pointer"
                        }`}
                      >
                        <Switch
                          label={`${d.label}: ${x.label}`}
                          checked={cur}
                          disabled={!!why}
                          title={why ?? x.hint}
                          onChange={() => onChange(setField(permissions, d.key, x.field, !cur, canGrant))}
                        />
                        {x.label}
                      </label>
                    );
                  })}
                </td>
                {PERM_COLUMNS.map((c) => {
                  const hint = d.columns[c];
                  if (hint === undefined) {
                    return (
                      <td key={c} className="select-none px-3 py-3 text-center text-zinc-300 dark:text-zinc-700">
                        –
                      </td>
                    );
                  }
                  const cur = allGranted || getField(permissions, d.key, c);
                  const why = reasonFor(d.key, c, cur);
                  return (
                    <td key={c} className="px-3 py-3 text-center">
                      <Switch
                        label={`${d.label}: ${COLUMN_HEAD[c]}`}
                        checked={cur}
                        disabled={!!why}
                        title={why ?? hint}
                        onChange={() => onChange(setField(permissions, d.key, c, !cur, canGrant))}
                      />
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-center">
                  {allGranted ? (
                    <span className="select-none text-zinc-300 dark:text-zinc-700">–</span>
                  ) : (
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => onChange(revokeModule(permissions, d.key))}
                      title={readOnly ? "Izin akun ini tidak bisa Anda ubah" : `Cabut akses ${d.label}`}
                      aria-label={`Cabut akses ${d.label}`}
                      className="rounded-md p-1.5 text-lco-coral transition-colors duration-150 hover:bg-lco-coral/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Modal: Tambah Akses Modul ───────────────────────────────────────────────

const INITIAL_ROWS: { field: keyof InitialGrant; title: string; hint: string }[] = [
  { field: "create", title: "Tambah Data", hint: "Izin menambah data baru (bila modul punya aksi ini)" },
  { field: "edit", title: "Ubah Data", hint: "Izin mengubah data yang sudah ada" },
  { field: "delete", title: "Hapus Data", hint: "Izin menghapus / membatalkan data" },
];

export function AddModuleModal({
  available,
  onClose,
  onSubmit,
}: {
  /** Modul yang belum punya akses dan boleh diberikan oleh pengguna ini. */
  available: ModuleDef[];
  onClose: () => void;
  onSubmit: (keys: PermKey[], initial: InitialGrant) => void;
}) {
  const [selected, setSelected] = useState<PermKey[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showError, setShowError] = useState(false);
  const [initial, setInitial] = useState<InitialGrant>({ create: true, edit: true, delete: false });
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelOf = (k: PermKey) => available.find((d) => d.key === k)?.label ?? String(k);
  const options = useMemo(
    () =>
      available.filter(
        (d) => !selected.includes(d.key) && d.label.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [available, selected, query],
  );
  const allSelected = available.length > 0 && selected.length === available.length;

  // Tutup dropdown bila klik di luar
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Escape: tutup dropdown dulu, lalu modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (open) setOpen(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const pick = (k: PermKey) => {
    setSelected((s) => [...s, k]);
    setQuery("");
    setShowError(false);
    inputRef.current?.focus();
  };
  const unpick = (k: PermKey) => setSelected((s) => s.filter((x) => x !== k));

  const submit = () => {
    if (selected.length === 0) {
      setShowError(true);
      setOpen(false);
      return;
    }
    onSubmit(selected, initial);
  };

  const err = showError && selected.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-module-title"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-start gap-3 border-b border-zinc-100 px-5 pt-5 pb-4 dark:border-zinc-800">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lco-green/10 text-lco-green dark:text-lco-teal">
            <Layers className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="add-module-title" className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Tambah Akses Modul
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Tetapkan modul dan izin awalnya untuk user ini
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="p-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {available.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Semua modul yang boleh Anda berikan sudah punya akses.
            </p>
          ) : (
            <>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Pilih Modul <span className="text-lco-coral">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(allSelected ? [] : available.map((d) => d.key));
                      setShowError(false);
                    }}
                    className="text-xs font-semibold text-lco-green hover:underline dark:text-lco-teal"
                  >
                    {allSelected ? "Batal Pilih Semua" : "Pilih Semua"}
                  </button>
                </div>

                <div ref={boxRef} className="relative">
                  <div
                    onClick={() => {
                      setOpen(true);
                      inputRef.current?.focus();
                    }}
                    className={`flex min-h-[42px] cursor-text items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5 transition-colors duration-150 dark:bg-zinc-900 ${
                      err
                        ? "border-lco-coral ring-2 ring-lco-coral/20"
                        : open
                          ? "border-lco-teal ring-2 ring-lco-teal/20"
                          : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      {selected.map((k) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1 rounded-md bg-lco-green/15 py-0.5 pr-1 pl-2 text-xs font-semibold text-lco-green dark:bg-lco-teal/20 dark:text-lco-teal"
                        >
                          {labelOf(k)}
                          <button
                            type="button"
                            aria-label={`Hapus ${labelOf(k)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              unpick(k);
                            }}
                            className="rounded p-0.5 hover:bg-black/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && query === "" && selected.length > 0) {
                            unpick(selected[selected.length - 1]);
                          } else if (e.key === "Enter") {
                            e.preventDefault();
                            if (options[0]) pick(options[0].key);
                          }
                        }}
                        placeholder={selected.length === 0 ? "Pilih satu atau beberapa modul..." : ""}
                        aria-label="Cari modul"
                        className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100 dark:placeholder-zinc-500"
                      />
                    </div>
                    {selected.length > 0 && (
                      <button
                        type="button"
                        aria-label="Kosongkan pilihan"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected([]);
                        }}
                        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <span className="w-px self-stretch bg-zinc-200 dark:bg-zinc-800" />
                    <ChevronDown
                      className={`mx-1 h-4 w-4 text-zinc-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                    />
                  </div>

                  {open && (
                    <ul
                      role="listbox"
                      className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      {options.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-zinc-400">
                          {selected.length === available.length ? "Semua modul sudah dipilih" : "Modul tidak ditemukan"}
                        </li>
                      ) : (
                        options.map((d) => (
                          <li
                            key={d.key}
                            role="option"
                            aria-selected={false}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pick(d.key)}
                            className="cursor-pointer px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                          >
                            {d.label}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
                {err && <p className="mt-1.5 text-xs text-lco-coral">Minimal pilih satu modul</p>}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                <p className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Izin Awal Modul</p>
                <div className="space-y-3">
                  {INITIAL_ROWS.map((r) => (
                    <div key={r.field} className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{r.title}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{r.hint}</p>
                      </div>
                      <Switch
                        label={r.title}
                        checked={initial[r.field]}
                        onChange={() => setInitial((s) => ({ ...s, [r.field]: !s[r.field] }))}
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                  Izin hanya berlaku di modul yang memang punya aksi itu. “Lihat” selalu aktif.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Batalkan
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={available.length === 0}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              selected.length === 0 ? "bg-lco-green/50 hover:bg-lco-green/60" : "bg-lco-green hover:bg-lco-green-hover"
            }`}
          >
            {selected.length > 0 ? `Tambah Akses (${selected.length} Modul)` : "Tambah Akses"}
          </button>
        </div>
      </div>
    </div>
  );
}
