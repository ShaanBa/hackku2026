import { useEffect, useState } from "react";
import { DevModeContext } from "./devModeCore";

const DEV_KEY = "bom_dev_enabled";
const SECRET_KEY = "bom_admin_secret";

export function DevModeProvider({ children }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(DEV_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [adminSecret, setAdminSecret] = useState(() => {
    try {
      return localStorage.getItem(SECRET_KEY) || "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DEV_KEY, enabled ? "1" : "0");
    } catch {
      // ignore
    }
  }, [enabled]);

  useEffect(() => {
    try {
      if (adminSecret) localStorage.setItem(SECRET_KEY, adminSecret);
      else localStorage.removeItem(SECRET_KEY);
    } catch {
      // ignore
    }
  }, [adminSecret]);

  return (
    <DevModeContext.Provider value={{ enabled, setEnabled, adminSecret, setAdminSecret }}>
      {children}
    </DevModeContext.Provider>
  );
}
