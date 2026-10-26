import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../application/auth/AuthContext";

const navItems = [
  ["/workspace", "Workspace"],
  ["/builder", "Builder"],
  ["/execute", "Run AI"],
  ["/intelligence", "Intelligence"],
  ["/versions", "Versions"],
  ["/templates", "Templates"],
  ["/think-first", "Think First"],
  ["/roles", "Roles"],
] as const;

export function AppShell() {
  const { user, quota, logout } = useAuth();
  const [logoutError, setLogoutError] = useState("");

  async function handleLogout() {
    setLogoutError("");
    try {
      await logout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Could not sign out cleanly.");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">P</span>
          <div>
            <strong>PromptOS</strong>
            <span>Engineering Workbench</span>
          </div>
        </div>

        <nav className="nav" aria-label="Primary navigation">
          {navItems.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/workspace"}
              className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
            >
              {label}
            </NavLink>
          ))}
          {user?.role === "admin" && (
            <NavLink
              to="/admin"
              className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
            >
              Security
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          {logoutError && <span className="sidebar-error" role="alert">{logoutError}</span>}
          <div className="signed-in-user">
            <span className="status-dot" />
            <span className="user-email">{user?.email}</span>
            {quota && <span className="quota-badge" title="AI requests remaining today">{quota.remaining}/{quota.limit} AI</span>}
          </div>
          <button className="sign-out-button" onClick={() => void handleLogout()}>Sign out</button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
