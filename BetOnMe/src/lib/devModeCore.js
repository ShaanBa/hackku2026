import { createContext, useContext } from "react";

export const DevModeContext = createContext({
  enabled: false,
  adminSecret: "",
  setEnabled: () => {},
  setAdminSecret: () => {},
});

export function useDevMode() {
  return useContext(DevModeContext);
}
