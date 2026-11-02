"use client";

// ── TAMBAHAN ── Input nominal rupiah dengan pemisah ribuan otomatis:
// mengetik 200000 langsung tampil 200.000. Pengganti <input type="number"> /
// <input inputMode="numeric"> untuk semua kolom uang, supaya kasir tidak salah
// hitung jumlah nol.
//
// Cara pakai (ganti `onChange` dengan `onValueChange`):
//   <MoneyInput value={price} onValueChange={(raw) => setPrice(raw)} />
// `raw` selalu string berisi ANGKA SAJA ("200000", atau "" kalau kosong) —
// tanpa titik — jadi state/parse yang sudah ada (Number(raw), parseNumber,
// dll.) tetap bekerja seperti sebelumnya. Ketikan selain angka diabaikan.
//
// Posisi kursor dijaga: mengedit di tengah angka tidak melompat ke akhir.

import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import { formatMoneyDigits, sanitizeMoneyDigits } from "@/lib/pos/moneyInput";

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode" | "min" | "max" | "step"
>;

interface MoneyInputProps extends NativeInputProps {
  /** Nilai saat ini: string angka ("200000"), angka (200000), atau kosong. */
  value: string | number | null | undefined;
  /** Dipanggil dengan string angka saja (tanpa titik). "" = dikosongkan. */
  onValueChange: (raw: string) => void;
  /** Batas jumlah digit (default 12, cukup sampai ratusan miliar). */
  maxDigits?: number;
}

function countDigitsBefore(text: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < caret && i < text.length; i += 1) {
    if (text[i] >= "0" && text[i] <= "9") count += 1;
  }
  return count;
}

function caretForDigitCount(text: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] >= "0" && text[i] <= "9") {
      seen += 1;
      if (seen === digitCount) return i + 1;
    }
  }
  return text.length;
}

const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  function MoneyInput(
    { value, onValueChange, maxDigits = 12, ...rest },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLInputElement | null>(null);
    const pendingCaretDigits = useRef<number | null>(null);

    const display = formatMoneyDigits(
      sanitizeMoneyDigits(value == null ? "" : String(value), maxDigits),
    );

    // Setelah React merender nilai berformat, kembalikan kursor ke posisi
    // digit yang sama seperti sebelum diformat ulang.
    useLayoutEffect(() => {
      const el = innerRef.current;
      const digits = pendingCaretDigits.current;
      if (el && digits !== null && document.activeElement === el) {
        const pos = caretForDigitCount(el.value, digits);
        el.setSelectionRange(pos, pos);
      }
      pendingCaretDigits.current = null;
    });

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      const el = event.target;
      const caret = el.selectionStart ?? el.value.length;
      pendingCaretDigits.current = countDigitsBefore(el.value, caret);
      onValueChange(sanitizeMoneyDigits(el.value, maxDigits));
    };

    return (
      <input
        {...rest}
        ref={(node) => {
          innerRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        onChange={handleChange}
      />
    );
  },
);

export default MoneyInput;
