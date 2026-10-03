import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';

// The context and its hook live apart from AuthProvider so that file exports
// only a component, which is what keeps fast refresh working on it.

export interface AuthValue {
  session: Session | null;
  loading: boolean;
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
