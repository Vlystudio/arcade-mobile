import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { AppRole } from "../components/role-badge";
import { isElevatedRole } from "../components/role-badge";

type AdminCtx = {
  role: AppRole;
  isAdmin: boolean;
  isArcadeOfficial: boolean;
  adminLoading: boolean;
};

const AdminContext = createContext<AdminCtx>({
  role: "user",
  isAdmin: false,
  isArcadeOfficial: false,
  adminLoading: true,
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<AppRole>("user");
  const [adminLoading, setAdminLoading] = useState(true);

  async function check() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setRole("user");
      setAdminLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (error) console.warn("[AdminContext] profiles query error:", error.message);
    setRole(((data?.role as AppRole) ?? "user"));
    setAdminLoading(false);
  }

  useEffect(() => {
    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) check();
      else { setRole("user"); setAdminLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const isAdmin = isElevatedRole(role);
  const isArcadeOfficial = isAdmin;

  return (
    <AdminContext.Provider value={{ role, isAdmin, isArcadeOfficial, adminLoading }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
