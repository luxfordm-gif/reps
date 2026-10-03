import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { markSignedIn } from './returning';
import { AuthContext } from './useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      // Every route into a session passes through here — password, OAuth
      // redirect, or a session restored on launch — so this is the one place
      // that has to remember the device has been signed in.
      if (data.session) markSignedIn();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (sess) markSignedIn();
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setPasswordRecovery(false);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        passwordRecovery,
        clearPasswordRecovery: () => setPasswordRecovery(false),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
