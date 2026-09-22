"use client";

import { createContext, useContext } from "react";

interface CurrentUser {
  id: string;
  email: string;
}

export const CurrentUserContext = createContext<CurrentUser | null>(null);

export function useCurrentUser() {
  const user = useContext(CurrentUserContext);
  return { user, userId: user?.id ?? "", loading: false };
}
