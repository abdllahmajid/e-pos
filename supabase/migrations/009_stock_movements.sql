-- Migration: Mutasi stok & opname (PRD §17 T-05) — lapisan database.
--
-- ============================================================================
-- TEMUAN PENTING SEBELUM MEMBACA MIGRATION INI
-- ============================================================================
-- PRD §15.4 menulis "tabel `stock_movements` belum ada". Itu TIDAK akurat untuk
-- database yang sedang berjalan sekarang:
--
--   1. `scripts/setup-database.sql` (cara database production ini dibuat — lihat
--      temuan T-01 di PROGRESS.md) SUDAH membuat tabel `stock_movements`, tapi
--      versi "polos": `type` cuma TEXT tanpa check, TANPA RLS, tanpa index,
--      `created_by` -> profiles(id).
--   2. Migration `004_return_and_void.sql` juga punya `create table if not exists
--      public.stock_movements` versi lebih ketat (ada check `type`, `created_by`
--      -> auth.users). Karena `if not exists`, di database production blok itu
--      DILEWATI — jadi yang benar-benar hidup adalah versi polos dari (1).
--   3. RPC `return_transaction` & `void_transaction` (004) SUDAH menulis baris
--      ke tabel ini (type 'return' & 'void'). Jadi tabelnya bukan kosong.
--
-- Konsekuensi: migration ini TIDAK membuat tabel baru dari nol, melainkan
-- **mengeraskan tabel yang sudah ada** (harden) supaya identik apapun jalur
-- pembuatannya (setup-database.sql ATAU rantai migration), lalu menambah yang
-- benar-benar belum ada: RLS, index, RPC opname/penyesuaian, dan pencatatan
-- mutasi 'sale' dari `create_transaction`.
--
-- ============================================================================
-- KEPUTUSAN DESAIN
-- ============================================================================
-- 1. **Tidak pakai trigger di `products`.** Godaan: bikin trigger `after update of
--    stock on products` supaya semua perubahan stok otomatis tercatat. Ditolak
--    karena RPC `return_transaction`/`void_transaction` (004) SUDAH menulis baris
--    mutasi sendiri — trigger akan membuat setiap retur tercatat DUA KALI. Jadi
--    pola yang dipakai konsisten: **yang mengubah `products.stock` wajib sekalian
--    menulis `stock_movements` di RPC yang sama, dalam satu transaksi DB.**
-- 2. **Tidak ada jalur tulis langsung dari client.** RLS di bawah sengaja hanya
--    memberi policy SELECT; tidak ada policy INSERT/UPDATE/DELETE sama sekali.
--    Semua penulisan lewat RPC `security definer` (yang memang melewati RLS).
--    Ini yang membuat invariant "stok berubah <=> ada barisnya di stock_movements"
--    tidak bisa dibocorkan dari sisi client (Aturan Main #5 PRD).
-- 3. **Alasan wajib untuk mutasi manual** ('opname'/'adjustment') ditegakkan DUA
--    lapis: check constraint di tabel (bawah) + validasi di RPC `adjust_stock`
--    (pesan Indonesia yang enak dibaca). Mutasi otomatis ('sale') tidak butuh
--    alasan — referensinya nomor transaksi.
-- 4. **Akses stok = admin/supervisor** (PRD §5: baris `stok` -> kasir "—").
--    Kasir tetap bisa berjualan (create_transaction menulis mutasi 'sale' lewat
--    security definer, bukan lewat hak akses kasir), tapi kasir tidak bisa
--    membaca riwayat mutasi maupun melakukan opname.
-- 5. **Produk jasa (`is_service` / type 'JASA') tidak punya mutasi stok** —
--    stoknya tak terbatas (pola yang sudah dipakai `create_transaction` 003).
--    `adjust_stock` menolak produk jasa dengan pesan jelas.
-- 6. **Backfill mutasi 'sale' untuk transaksi lama** dilakukan di bagian 7,
--    idempotent (aman dijalankan berulang). Lihat catatan di sana soal kenapa
--    "stok fisik = akumulasi mutasi" tidak pernah bisa berlaku mutlak tanpa
--    baris stok awal produk.

-- --------------------------------------------------------
-- 1. Tabel stock_movements — dibuat kalau memang belum ada, lalu diseragamkan
--    (idempotent, aman untuk database yang tabelnya sudah terisi data lama).
-- --------------------------------------------------------

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  type text not null,
  qty_delta integer not null,
  reference_id uuid,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Kolom-kolom di bawah ditambahkan hanya kalau tabelnya versi lama yang belum
-- punya (mis. dibuat tangan lewat SQL Editor). Tidak mengubah kolom yang sudah ada.
alter table public.stock_movements add column if not exists reference_id uuid;
alter table public.stock_movements add column if not exists reason text;
alter table public.stock_movements add column if not exists created_by uuid;
alter table public.stock_movements add column if not exists created_at timestamptz not null default now();

comment on table public.stock_movements is
  'Audit trail mutasi stok (PRD §6, §17 T-05). Satu-satunya cara sah mengubah products.stock adalah lewat RPC yang sekaligus menulis baris di sini: create_transaction (sale), return_transaction (return), void_transaction (void), adjust_stock (opname/adjustment).';
comment on column public.stock_movements.type is
  'sale = penjualan (qty_delta negatif) · return = retur masuk · void = pembatalan transaksi · opname = hasil hitung fisik · adjustment = penyesuaian manual (rusak/hilang/koreksi input).';
comment on column public.stock_movements.qty_delta is
  'Selisih stok: NEGATIF = stok berkurang, POSITIF = stok bertambah. Stok baru = stok lama + qty_delta.';
comment on column public.stock_movements.reference_id is
  'Transaksi sumber untuk type sale/return/void (transactions.id). NULL untuk mutasi manual.';
comment on column public.stock_movements.reason is
  'Wajib diisi untuk type opname/adjustment (ditegakkan check constraint + RPC adjust_stock). Boleh NULL untuk mutasi otomatis.';

-- --------------------------------------------------------
-- 2. Constraint: daftar `type` yang sah + alasan wajib untuk mutasi manual.
--    Keduanya dipasang NOT VALID lalu di-VALIDATE terpisah di dalam blok yang
--    menangkap error: kalau ternyata ada BARIS LAMA yang melanggar (mis. type
--    'SALE' huruf besar dari percobaan manual), migration TIDAK ikut gagal —
--    constraint tetap terpasang untuk data BARU, dan muncul WARNING supaya
--    barisnya dibereskan manual. Ini lebih aman daripada migration yang gagal
--    di tengah jalan pada database yang sudah berisi data.
-- --------------------------------------------------------

alter table public.stock_movements drop constraint if exists stock_movements_type_check;
alter table public.stock_movements
  add constraint stock_movements_type_check
  check (type in ('sale', 'return', 'opname', 'adjustment', 'void'))
  not valid;

alter table public.stock_movements drop constraint if exists stock_movements_manual_reason_check;
alter table public.stock_movements
  add constraint stock_movements_manual_reason_check
  check (
    type not in ('opname', 'adjustment')
    or (reason is not null and btrim(reason) <> '')
  )
  not valid;

do $$
begin
  begin
    alter table public.stock_movements validate constraint stock_movements_type_check;
  exception when check_violation then
    raise warning 'stock_movements: ada baris lama dengan type di luar (sale/return/opname/adjustment/void). Constraint tetap aktif untuk data baru; rapikan baris lama lalu jalankan: alter table public.stock_movements validate constraint stock_movements_type_check;';
  end;

  begin
    alter table public.stock_movements validate constraint stock_movements_manual_reason_check;
  exception when check_violation then
    raise warning 'stock_movements: ada baris opname/adjustment lama tanpa alasan. Constraint tetap aktif untuk data baru; isi alasannya lalu jalankan: alter table public.stock_movements validate constraint stock_movements_manual_reason_check;';
  end;
end $$;

-- --------------------------------------------------------
-- 3. Index — pola query yang dipakai UI (hooks/useStock.ts):
--    (a) riwayat mutasi terbaru dulu, (b) riwayat/kartu stok per produk.
-- --------------------------------------------------------

create index if not exists stock_movements_created_at_idx
  on public.stock_movements (created_at desc);

create index if not exists stock_movements_product_created_idx
  on public.stock_movements (product_id, created_at desc);

create index if not exists stock_movements_reference_idx
  on public.stock_movements (reference_id);

-- --------------------------------------------------------
-- 4. RLS — HANYA select, dan hanya admin/supervisor (PRD §5 modul `stok`).
--    Sengaja TIDAK ada policy insert/update/delete: riwayat mutasi adalah jejak
--    audit, tidak boleh ditulis/diedit/dihapus langsung dari client. Semua RPC
--    penulis (create_transaction, return_transaction, void_transaction,
--    adjust_stock) berjalan `security definer` sehingga tidak terpengaruh.
-- --------------------------------------------------------

alter table public.stock_movements enable row level security;

drop policy if exists "stock_movements_select_supervisor" on public.stock_movements;
create policy "stock_movements_select_supervisor"
  on public.stock_movements for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'supervisor')
        and profiles.is_active = true
    )
  );

-- --------------------------------------------------------
-- 5. RPC adjust_stock — opname & penyesuaian manual.
--
--    p_type = 'opname'     -> p_value adalah HASIL HITUNG FISIK (stok sebenarnya
--                             di rak). Selisihnya dihitung server: p_value - stok
--                             sistem. Kasir/admin tidak perlu (dan tidak bisa)
--                             mengirim qty_delta versinya sendiri.
--    p_type = 'adjustment' -> p_value adalah SELISIH langsung (+/-), untuk kasus
--                             barang rusak/hilang/koreksi salah input.
--
--    Kenapa satu RPC untuk dua hal: jalur tulisnya persis sama (kunci baris
--    produk -> hitung stok baru -> update -> catat mutasi), yang beda cuma cara
--    menerjemahkan p_value jadi qty_delta. Memecah jadi dua fungsi hanya akan
--    menduplikasi validasi permission & anti-stok-minus.
-- --------------------------------------------------------

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_type text,
  p_value integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_role public.user_role;
    v_product RECORD;
    v_old_stock INTEGER;
    v_qty_delta INTEGER;
    v_new_stock INTEGER;
    v_movement_id UUID;
begin

    -- --------------------------------------------------------
    -- Permission (PRD §5: modul `stok` = supervisor & admin saja)
    -- --------------------------------------------------------

    SELECT role INTO v_role
    FROM profiles
    WHERE id = auth.uid()
      AND is_active = TRUE;

    IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
        RAISE EXCEPTION 'Anda tidak punya izin untuk mengubah stok';
    END IF;

    -- --------------------------------------------------------
    -- Validasi input
    -- --------------------------------------------------------

    IF p_type IS NULL OR p_type NOT IN ('opname', 'adjustment') THEN
        RAISE EXCEPTION 'Jenis mutasi manual tidak valid (hanya opname / adjustment)';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'Alasan wajib diisi untuk mutasi stok manual';
    END IF;

    IF p_value IS NULL THEN
        RAISE EXCEPTION 'Jumlah tidak boleh kosong';
    END IF;

    -- Kunci baris produk selama dihitung, supaya opname tidak balapan dengan
    -- transaksi penjualan yang sedang berjalan (pola sama seperti
    -- create_transaction: SELECT ... FOR UPDATE).
    SELECT *
    INTO v_product
    FROM products
    WHERE id = p_product_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produk tidak ditemukan';
    END IF;

    IF v_product.is_service = TRUE OR v_product.type = 'JASA' THEN
        RAISE EXCEPTION 'Produk "%" adalah jasa — stoknya tidak terbatas dan tidak bisa diopname', v_product.name;
    END IF;

    v_old_stock := COALESCE(v_product.stock, 0);

    IF p_type = 'opname' THEN
        IF p_value < 0 THEN
            RAISE EXCEPTION 'Hasil hitung fisik tidak boleh negatif';
        END IF;
        v_qty_delta := p_value - v_old_stock;
    ELSE
        -- adjustment: p_value SUDAH berupa selisih.
        IF p_value = 0 THEN
            RAISE EXCEPTION 'Penyesuaian 0 tidak ada artinya — isi jumlah plus atau minus';
        END IF;
        v_qty_delta := p_value;
    END IF;

    v_new_stock := v_old_stock + v_qty_delta;

    IF v_new_stock < 0 THEN
        RAISE EXCEPTION 'Stok tidak boleh minus. Stok sekarang %, penyesuaian %', v_old_stock, v_qty_delta;
    END IF;

    -- --------------------------------------------------------
    -- Tulis: update stok + catat mutasi, satu transaksi DB.
    --
    -- Catatan: opname dengan selisih 0 (hitungan fisik cocok dengan sistem)
    -- TETAP dicatat sebagai baris qty_delta = 0. Itu informasi audit yang
    -- berharga — "produk ini pernah diopname tanggal sekian dan hasilnya cocok"
    -- beda artinya dengan "produk ini tidak pernah diopname".
    -- --------------------------------------------------------

    IF v_qty_delta <> 0 THEN
        UPDATE products
        SET stock = v_new_stock,
            updated_at = NOW()
        WHERE id = p_product_id;
    END IF;

    INSERT INTO stock_movements (
        product_id, type, qty_delta, reference_id, reason, created_by
    )
    VALUES (
        p_product_id, p_type, v_qty_delta, NULL, btrim(p_reason), auth.uid()
    )
    RETURNING id INTO v_movement_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'movement_id', v_movement_id,
        'product_id', p_product_id,
        'product_name', v_product.name,
        'old_stock', v_old_stock,
        'qty_delta', v_qty_delta,
        'new_stock', v_new_stock
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$function$;

comment on function public.adjust_stock(uuid, text, integer, text) is
  'Opname (p_value = hasil hitung fisik) / penyesuaian manual (p_value = selisih +/-). Admin & supervisor saja, alasan wajib, stok tidak boleh jadi minus. Sekali jalan: update products.stock + insert stock_movements.';

-- --------------------------------------------------------
-- 6. RPC create_transaction — TAMBAHAN: catat mutasi 'sale'.
--
--    Pola sama seperti migration 006 & 007: `create or replace`, signature TIDAK
--    berubah, hanya body yang ditambah. Yang baru di versi ini cuma satu blok
--    INSERT ke stock_movements di dalam loop item (ditandai "TAMBAHAN (T-05)").
--    Seluruh isi lain sengaja disalin apa adanya dari 007 supaya file ini bisa
--    dibaca sebagai versi terbaru yang utuh tanpa menelusuri 3 migration.
-- --------------------------------------------------------

create or replace function public.create_transaction(
  p_items jsonb,
  p_subtotal bigint,
  p_discount bigint default 0,
  p_tax bigint default 0,
  p_total bigint default 0,
  p_customer_name text default null::text,
  p_notes text default null::text,
  p_payment_method payment_method default 'CASH'::payment_method,
  p_payment_amount bigint default 0,
  p_received_amount bigint default null::bigint,
  p_due_date date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_transaction_id UUID;
    v_receipt_no TEXT;
    v_item JSONB;
    v_product_id UUID;
    v_product RECORD;
    v_qty INTEGER;
    v_unit_price BIGINT;
    v_item_discount BIGINT;
    v_item_subtotal BIGINT;
    v_payment_id UUID;
    v_change BIGINT := 0;
    v_sequence BIGINT;
    v_cashier_id UUID;
    v_shift_id UUID;
begin

    -- --------------------------------------------------------
    -- Basic validation
    -- --------------------------------------------------------

    IF p_items IS NULL
       OR jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0
    THEN
        RAISE EXCEPTION 'Transaction must contain at least one item';
    END IF;

    IF p_subtotal < 0
       OR p_discount < 0
       OR p_tax < 0
       OR p_total < 0
    THEN
        RAISE EXCEPTION 'Transaction amounts cannot be negative';
    END IF;

    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative';
    END IF;

    -- TEMPO wajib nama pelanggan + tanggal jatuh tempo (migration 006, PRD §17 T-02).
    IF p_payment_method = 'TEMPO' THEN
        IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
            RAISE EXCEPTION 'Nama pelanggan wajib diisi untuk pembayaran TEMPO';
        END IF;

        IF p_due_date IS NULL THEN
            RAISE EXCEPTION 'Tanggal jatuh tempo wajib diisi untuk pembayaran TEMPO';
        END IF;
    END IF;

    v_cashier_id := auth.uid();

    -- ── TAMBAHAN (T-04) ── Wajib shift aktif sebelum transaksi (PRD §17 T-04 DoD:
    -- "kasir tidak bisa transaksi sebelum buka shift"). Sengaja hanya ditegakkan kalau
    -- v_cashier_id diketahui (auth.uid() tidak NULL) — konsisten dengan pola cashier_id
    -- di migration 003: pemanggilan RPC di luar konteks user login (kalau memang ada)
    -- tidak ikut mendadak patah karena aturan shift ini.
    IF v_cashier_id IS NOT NULL THEN
        SELECT id
        INTO v_shift_id
        FROM shift_sessions
        WHERE cashier_id = v_cashier_id
          AND status = 'OPEN'
        LIMIT 1;

        IF v_shift_id IS NULL THEN
            RAISE EXCEPTION
                'Anda belum membuka shift kasir. Buka shift terlebih dahulu sebelum bertransaksi.';
        END IF;
    END IF;


    -- --------------------------------------------------------
    -- Generate receipt sequence
    --
    -- Sequence is monthly:
    -- LCO-STR/26/09/000001
    -- LCO-STR/26/09/000002
    -- --------------------------------------------------------

    SELECT COALESCE(
        MAX(
            split_part(receipt_no, '/', 4)::BIGINT
        ),
        0
    ) + 1
    INTO v_sequence
    FROM transactions
    WHERE receipt_no LIKE
        'LCO-STR/'
        || TO_CHAR(NOW(), 'YY')
        || '/'
        || TO_CHAR(NOW(), 'MM')
        || '/%';

    v_receipt_no :=
        'LCO-STR/'
        || TO_CHAR(NOW(), 'YY')
        || '/'
        || TO_CHAR(NOW(), 'MM')
        || '/'
        || LPAD(v_sequence::TEXT, 6, '0');


    -- --------------------------------------------------------
    -- Create transaction header
    -- ── TAMBAHAN (T-04) ── kolom shift_id diisi dari v_shift_id.
    -- --------------------------------------------------------

    INSERT INTO transactions (
        receipt_no,
        status,
        subtotal,
        discount,
        tax,
        total,
        customer_name,
        notes,
        cashier_id,
        shift_id
    )
    VALUES (
        v_receipt_no,
        'PAID',
        p_subtotal,
        p_discount,
        p_tax,
        p_total,
        p_customer_name,
        p_notes,
        v_cashier_id,
        v_shift_id
    )
    RETURNING id INTO v_transaction_id;


    -- --------------------------------------------------------
    -- Process transaction items
    -- --------------------------------------------------------

    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP

        v_product_id :=
            (v_item->>'product_id')::UUID;

        v_qty :=
            (v_item->>'qty')::INTEGER;

        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION
                'Invalid quantity for product %',
                v_product_id;
        END IF;


        -- Lock the product row while checking stock.
        SELECT *
        INTO v_product
        FROM products
        WHERE id = v_product_id
          AND is_active = TRUE
          AND deleted_at IS NULL
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Product % is not available',
                v_product_id;
        END IF;


        -- ----------------------------------------------------
        -- Services have unlimited stock.
        -- ----------------------------------------------------

        IF NOT (
            v_product.is_service = TRUE
            OR v_product.type = 'JASA'
        ) THEN

            IF COALESCE(v_product.stock, 0) < v_qty THEN
                RAISE EXCEPTION
                    'Insufficient stock for product "%". Available: %, requested: %',
                    v_product.name,
                    COALESCE(v_product.stock, 0),
                    v_qty;
            END IF;

            UPDATE products
            SET
                stock = stock - v_qty,
                updated_at = NOW()
            WHERE id = v_product_id;

            -- ── TAMBAHAN (T-05) ── Jejak audit mutasi stok untuk penjualan.
            -- qty_delta NEGATIF (stok berkurang), reference_id = transaksi ini,
            -- reason NULL (mutasi otomatis, referensinya sudah jelas dari nomor
            -- struk). Ditulis di dalam transaksi DB yang sama dengan UPDATE stok
            -- di atas, jadi tidak mungkin stok berkurang tanpa ada jejaknya —
            -- kalau salah satu gagal, dua-duanya di-rollback.
            -- Produk JASA sengaja TIDAK dicatat: stoknya memang tak terbatas,
            -- barisnya cuma akan jadi sampah audit.
            INSERT INTO stock_movements (
                product_id, type, qty_delta, reference_id, reason, created_by
            )
            VALUES (
                v_product_id, 'sale', -v_qty, v_transaction_id, NULL, v_cashier_id
            );

        END IF;


        -- ----------------------------------------------------
        -- Item amounts
        -- ----------------------------------------------------

        v_unit_price :=
            COALESCE(
                (v_item->>'unit_price')::BIGINT,
                v_product.sell_price
            );

        v_item_discount :=
            COALESCE(
                (v_item->>'discount')::BIGINT,
                0
            );

        v_item_subtotal :=
            COALESCE(
                (v_item->>'subtotal')::BIGINT,
                (v_unit_price * v_qty) - v_item_discount
            );


        -- ----------------------------------------------------
        -- Save transaction item snapshot
        -- ----------------------------------------------------

        INSERT INTO transaction_items (
            transaction_id,
            product_id,
            product_name,
            sku,
            unit,
            qty,
            unit_price,
            discount,
            subtotal
        )
        VALUES (
            v_transaction_id,
            v_product.id,
            v_product.name,
            v_product.sku,
            v_product.unit,
            v_qty,
            v_unit_price,
            v_item_discount,
            v_item_subtotal
        );

    END LOOP;


    -- --------------------------------------------------------
    -- Cash change
    -- --------------------------------------------------------

    IF p_payment_method = 'CASH' THEN

        IF p_received_amount IS NULL THEN
            RAISE EXCEPTION
                'Received amount is required for cash payment';
        END IF;

        IF p_received_amount < p_total THEN
            RAISE EXCEPTION
                'Cash received is insufficient';
        END IF;

        v_change :=
            p_received_amount - p_total;

    END IF;


    -- --------------------------------------------------------
    -- Save payment
    -- --------------------------------------------------------

    INSERT INTO payments (
        transaction_id,
        method,
        amount,
        received_amount,
        change_amount,
        due_date
    )
    VALUES (
        v_transaction_id,
        p_payment_method,
        p_payment_amount,
        p_received_amount,
        v_change,
        CASE WHEN p_payment_method = 'TEMPO' THEN p_due_date ELSE NULL END
    )
    RETURNING id INTO v_payment_id;


    -- --------------------------------------------------------
    -- Return result
    -- ── TAMBAHAN (T-04) ── shift_id disertakan di response, disiapkan untuk
    -- KasirModule.tsx kalau nanti perlu tampilkan info shift berjalan di layar Kasir.
    -- --------------------------------------------------------

    RETURN jsonb_build_object(
        'success', TRUE,
        'transaction_id', v_transaction_id,
        'receipt_no', v_receipt_no,
        'payment_id', v_payment_id,
        'change_amount', v_change,
        'shift_id', v_shift_id
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION
            'Failed to generate unique receipt number. Please retry the transaction';

    WHEN OTHERS THEN
        RAISE;
END;
$function$;

-- --------------------------------------------------------
-- 7. Backfill mutasi 'sale' untuk transaksi yang SUDAH terlanjur dibuat sebelum
--    migration ini (stoknya sudah berkurang, tapi tidak ada barisnya di
--    stock_movements).
--
--    Idempotent: `where not exists` per (reference_id, product_id, type) —
--    aman dijalankan berkali-kali, dan aman kalau migration ini diulang.
--    `created_at` diisi dari waktu transaksi aslinya (bukan now()) supaya
--    urutan kartu stok tetap masuk akal, `created_by` dari kasir transaksi.
--
--    CATATAN JUJUR soal DoD "stok fisik = akumulasi mutasi": invariant itu
--    berlaku untuk PERUBAHAN stok (setiap perubahan pasti ada barisnya), BUKAN
--    untuk nilai absolutnya — stok awal produk (diisi saat produk dibuat / import
--    Excel) tidak punya baris mutasi pembuka. Jadi rumus yang benar:
--        stok sekarang = stok awal produk + SUM(qty_delta)
--    Kalau nanti butuh angka absolut yang bisa direkonstruksi penuh dari mutasi
--    (mis. untuk laporan kartu stok periode), tambahkan mutasi 'adjustment'
--    bersaldo awal saat produk dibuat — itu perubahan di modul Produk, di luar
--    scope T-05 dan sengaja tidak dikerjakan sekarang.
-- --------------------------------------------------------

insert into public.stock_movements (
  product_id, type, qty_delta, reference_id, reason, created_by, created_at
)
select
  ti.product_id,
  'sale',
  -sum(ti.qty),
  ti.transaction_id,
  'Backfill otomatis migration 009 (transaksi sebelum pencatatan mutasi aktif)',
  -- `(array_agg(...))[1]` dipakai, bukan `max(t.cashier_id)`: agregat max() untuk
  -- tipe uuid tidak tersedia di semua versi Postgres. Nilainya sama saja karena
  -- semua baris dalam satu grup berasal dari transaksi yang sama.
  (array_agg(t.cashier_id))[1],
  max(t.created_at)
from public.transaction_items ti
join public.transactions t on t.id = ti.transaction_id
join public.products p on p.id = ti.product_id
where ti.product_id is not null
  and coalesce(p.is_service, false) = false
  and p.type <> 'JASA'
  and t.status in ('PAID', 'RETURN')
  and not exists (
    select 1 from public.stock_movements sm
    where sm.reference_id = ti.transaction_id
      and sm.product_id = ti.product_id
      and sm.type = 'sale'
  )
-- Digabung per (transaksi, produk): kalau satu struk punya 2 baris item produk
-- yang sama (mis. ditambahkan dua kali dengan harga beda), backfill-nya tetap
-- satu baris mutasi dengan qty total — supaya guard `not exists` di atas tidak
-- menyisakan separuh data saat migration diulang.
group by ti.transaction_id, ti.product_id;
