"use client";

import { useEffect, useState } from "react";
// ⚠️ GANTI path ini setelah kamu ketemu lokasi asli file Supabase client di project kamu.
import { createClient } from "@/lib/supabase/client";

// Harus sinkron dengan enum Postgres `user_role` di migration 002_setup_profiles_and_roles.sql
export type UserRole = "admin" | "supervisor" | "kasir" | "qc";

export interface AuthUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
}

interface UseAuthResult {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function loadProfile(authUserId: string, email: string | null) {
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, role, is_active")
      .eq("id", authUserId)
      .single();

    if (profileError || !data) {
      setError(
        "Login berhasil tapi profil tidak ditemukan — pastikan sudah insert baris di tabel profiles."
      );
      setUser(null);
      return;
    }

    setUser({
      id: authUserId,
      email,
      full_name: data.full_name,
      role: data.role,
      is_active: data.is_active,
    });
  }

  useEffect(() => {
    let isCancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isCancelled) return;
      if (session?.user) {
        loadProfile(session.user.id, session.user.email ?? null).finally(() =>
          setIsLoading(false)
        );
      } else {
        setIsLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadProfile(session.user.id, session.user.email ?? null);
      } else {
        setUser(null);
      }
    });

    return () => {
      isCancelled = true;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email: string, password: string) {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      const message = "Email atau password salah.";
      setError(message);
      return { error: message };
    }
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return { user, isLoading, error, signIn, signOut };
}