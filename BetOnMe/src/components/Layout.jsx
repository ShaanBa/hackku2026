import { useState, useEffect, useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import { useAuth } from "../lib/authContextCore";
import api from "../lib/api";

function Layout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [goals, setGoals] = useState([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsError, setGoalsError] = useState(null);

  // Redirect logic: kick unauthenticated users to /sign-in for private pages.
  useEffect(() => {
    if (loading) return;
    const isAuthPage = location.pathname.startsWith("/sign-in");
    if (!user && !isAuthPage) {
      navigate("/sign-in", { replace: true, state: { from: location.pathname } });
    }
    if (user && isAuthPage) {
      navigate("/", { replace: true });
    }
  }, [user, loading, location.pathname, navigate]);

  const refreshGoals = useCallback(async () => {
    if (!user) {
      setGoals([]);
      return;
    }
    setGoalsLoading(true);
    setGoalsError(null);
    try {
      const { goals: list } = await api.myGoals();
      setGoals(list || []);
    } catch (err) {
      setGoalsError(err.message || "Failed to load goals");
    } finally {
      setGoalsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshGoals();
  }, [refreshGoals]);

  // Shared context passed down via Outlet
  const ctx = {
    goals,
    goalsLoading,
    goalsError,
    refreshGoals,
    openSidebar: () => setSidebarOpen(true),
  };

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--text-dim)",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div>
      <Navbar onOpenSidebar={() => setSidebarOpen(true)} />
      <main>
        <Outlet context={ctx} />
      </main>
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        goals={goals}
      />
    </div>
  );
}

export default Layout;
