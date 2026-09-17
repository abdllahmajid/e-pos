import { createClient } from "../supabase/client";
import type { ProductType } from "./types";

const supabase = createClient();

export type CreateProductInput = {
  name: string;
  sku: string;
  barcode: string;
  type: ProductType;
  category_id: string;
  unit: string;
  sell_price: number;
  cost_price: number;
  stock: number;
  min_stock: number;
  photo_url: string;
  is_active: boolean;
};

export type CreateProductResult =
  | {
      success: true;
      product: {
        id: string;
      };
    }
  | {
      success: false;
      error: string;
    };

export async function createProduct(
  input: CreateProductInput,
): Promise<CreateProductResult> {
  const name = input.name.trim();
  const sku = input.sku.trim().toUpperCase();
  const barcode = input.barcode.trim();
  const unit = input.unit.trim();
  const photoUrl = input.photo_url.trim();

  if (!name) {
    return {
      success: false,
      error: "Nama produk wajib diisi.",
    };
  }

  if (!sku) {
    return {
      success: false,
      error: "SKU wajib diisi.",
    };
  }

  if (input.sell_price <= 0) {
    return {
      success: false,
      error: "Harga jual harus lebih dari 0.",
    };
  }

  if (input.cost_price < 0) {
    return {
      success: false,
      error: "Harga modal tidak boleh negatif.",
    };
  }

  if (input.stock < 0) {
    return {
      success: false,
      error: "Stok tidak boleh negatif.",
    };
  }

  if (input.min_stock < 0) {
    return {
      success: false,
      error: "Minimum stok tidak boleh negatif.",
    };
  }

  const isService = input.type === "JASA";

  const { data, error } = await supabase
    .from("products")
    .insert({
      name,
      sku,
      barcode: barcode || null,
      type: input.type,
      is_service: isService,
      category_id: input.category_id || null,
      unit: unit || null,
      sell_price: input.sell_price,
      cost_price: input.cost_price > 0 ? input.cost_price : null,
      stock: isService ? 0 : input.stock,
      min_stock: isService ? 0 : input.min_stock,
      photo_url: photoUrl || null,
      is_active: input.is_active,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        error: "SKU tersebut sudah digunakan. Gunakan SKU yang berbeda.",
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }

  return {
    success: true,
    product: {
      id: data.id,
    },
  };
}

export type UpdateProductInput = CreateProductInput & { id: string };

export type UpdateProductResult =
  | {
      success: true;
      product: {
        id: string;
      };
    }
  | {
      success: false;
      error: string;
    };

export async function updateProduct(
  input: UpdateProductInput,
): Promise<UpdateProductResult> {
  const name = input.name.trim();
  const sku = input.sku.trim().toUpperCase();
  const barcode = input.barcode.trim();
  const unit = input.unit.trim();
  const photoUrl = input.photo_url.trim();

  if (!name) {
    return {
      success: false,
      error: "Nama produk wajib diisi.",
    };
  }

  if (!sku) {
    return {
      success: false,
      error: "SKU wajib diisi.",
    };
  }

  if (input.sell_price <= 0) {
    return {
      success: false,
      error: "Harga jual harus lebih dari 0.",
    };
  }

  if (input.cost_price < 0) {
    return {
      success: false,
      error: "Harga modal tidak boleh negatif.",
    };
  }

  if (input.stock < 0) {
    return {
      success: false,
      error: "Stok tidak boleh negatif.",
    };
  }

  if (input.min_stock < 0) {
    return {
      success: false,
      error: "Minimum stok tidak boleh negatif.",
    };
  }

  const isService = input.type === "JASA";

  const { data, error } = await supabase
    .from("products")
    .update({
      name,
      sku,
      barcode: barcode || null,
      type: input.type,
      is_service: isService,
      category_id: input.category_id || null,
      unit: unit || null,
      sell_price: input.sell_price,
      cost_price: input.cost_price > 0 ? input.cost_price : null,
      stock: isService ? 0 : input.stock,
      min_stock: isService ? 0 : input.min_stock,
      photo_url: photoUrl || null,
      is_active: input.is_active,
    })
    .eq("id", input.id)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        error: "SKU tersebut sudah digunakan. Gunakan SKU yang berbeda.",
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }

  return {
    success: true,
    product: {
      id: data.id,
    },
  };
}