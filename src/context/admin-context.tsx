import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type AdminCtx = {
  isAdmin: boolean;
  isArcadeOfficial: boolean;
  adminLoading: boolean;
};

const AdminContext = createContext<AdminCtx>({
  isAdmin: false,
  isArcadeOfficial: false,
  adminLoading: true,
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isArcadeOfficial, setIsArcadeOfficial] = useState(false);
  const [adminLoading, setAdminLoading] = useState(true);

  async function check() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setIsAdmin(false);
      setIsArcadeOfficial(false);
      setAdminLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("is_admin, is_arcade_official")
      .eq("id", session.user.id)
      .single();
    if (error) console.warn("[AdminContext] profiles query error:", error.message);
    setIsAdmin(!!data?.is_admin);
    setIsArcadeOfficial(!!data?.is_arcade_official || !!data?.is_admin);
    setAdminLoading(false);
  }

  useEffect(() => {
    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) check();
      else { setIsAdmin(false); setIsArcadeOfficial(false); setAdminLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <AdminContext.Provider value={{ isAdmin, isArcadeOfficial, adminLoading }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
