import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Link, useNavigate, Navigate } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import { Spinner } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import VideoDetail from './pages/VideoDetail.jsx';
import Editor from './pages/Editor.jsx';
import Exports from './pages/Exports.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/Admin.jsx';

const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

function TopNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <nav className="topnav glass sheen">
      <Link to="/" className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M8 6.5v11l9-5.5z" fill="#fff" />
          </svg>
        </span>
        CLIPFORGE <span className="dim" style={{ fontWeight: 600 }}>AI</span>
      </Link>
      <NavLink to="/dashboard" className="navlink">Dashboard</NavLink>
      <NavLink to="/exports" className="navlink">Exports</NavLink>
      {user?.role === 'admin' && <NavLink to="/admin" className="navlink">Admin</NavLink>}
      <NavLink to="/settings" className="navlink">Settings</NavLink>
      <button
        className="btn sm ghost"
        onClick={() => { logout(); navigate('/'); }}
      >Sign out</button>
    </nav>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const auth = {
    user,
    setUser,
    logout: () => { setToken(null); setUser(null); },
  };

  if (loading) return <div style={{ paddingTop: 120 }}><Spinner label="Loading CLIPFORGE…" /></div>;

  const RequireAuth = ({ children }) => (user ? children : <Navigate to="/login" replace />);

  return (
    <AuthCtx.Provider value={auth}>
      {user && <TopNav />}
      <div className="shell">
        <Routes>
          <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/projects/:id" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
          <Route path="/videos/:id" element={<RequireAuth><VideoDetail /></RequireAuth>} />
          <Route path="/clips/:id/edit" element={<RequireAuth><Editor /></RequireAuth>} />
          <Route path="/exports" element={<RequireAuth><Exports /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </AuthCtx.Provider>
  );
}
