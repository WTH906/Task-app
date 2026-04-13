"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

interface CurrentUser {
  id: string;
  email: string;
}

/**
 * Centralized auth hook. Every page that needs the current user
 * should call this instead of manually doing supabase.auth.getUser().
 *
 * When shared projects land, any user-scoping logic changes here once.
 */
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id, email: data.user.email || "" });
      }
      setLoading(false);
    });
  }, []);

  return { user, userId: user?.id ?? "", loading };
}
