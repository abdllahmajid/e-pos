-- =========================================================================
-- LCO POS - MASTER DATABASE SETUP SCRIPT
-- Jalankan skrip ini di SQL Editor Supabase (Pilih: Run without RLS)
-- =========================================================================

-- 1. BUAT TIPE ENUM
CREATE TYPE product_type AS ENUM ('FASHION', 'SABLON', 'KONVEKSI', 'PERCETAKAN', 'MERCHANDISE', 'PARFUM', 'JASA');
CREATE TYPE payment_method AS ENUM ('tunai', 'transfer', 'QRIS', 'CASH', 'lainnya');
CREATE TYPE user_role AS ENUM ('admin', 'kasir', 'owner', 'supervisor');
CREATE TYPE transaction_status AS ENUM ('selesai', 'retur', 'void', 'pending', 'PAID', 'RETURN', 'VOID');

-- 2. TABEL KATEGORI
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true
);

-- 3. TABEL PROFIL PENGGUNA
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT,
    role user_role NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 4. TABEL PRODUK
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE NOT NULL,
    barcode TEXT,
    name TEXT NOT NULL,
    type product_type NOT NULL,
    is_service BOOLEAN DEFAULT false,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    unit TEXT,
    sell_price BIGINT NOT NULL,
    cost_price BIGINT,
    stock INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 0,
    photo_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 5. TABEL TRANSAKSI (INDUK)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_no TEXT NOT NULL,
    status transaction_status NOT NULL,
    subtotal BIGINT NOT NULL,
    discount BIGINT NOT NULL DEFAULT 0,
    tax BIGINT NOT NULL DEFAULT 0,
    total BIGINT NOT NULL,
    cashier_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    shift_id UUID,
    customer_name TEXT,
    customer_phone TEXT,
    notes TEXT,
    void_reason TEXT,
    related_transaction_id UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 6. TABEL ITEM TRANSAKSI
CREATE TABLE transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    sku TEXT,
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    returned_qty INTEGER NOT NULL DEFAULT 0,
    unit TEXT,
    unit_price BIGINT NOT NULL,
    discount BIGINT NOT NULL DEFAULT 0,
    subtotal BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 7. TABEL PEMBAYARAN
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    method payment_method NOT NULL,
    amount BIGINT NOT NULL,
    received_amount BIGINT,
    change_amount BIGINT,
    reference_no TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 8. TABEL PERGERAKAN STOK
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    qty_delta INTEGER NOT NULL,
    reference_id UUID,
    reason TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);