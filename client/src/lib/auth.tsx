import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface User {
  id: string;
  email: string;
  language: string;
  plan: string | null;
  isAdmin?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, language?: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get("token");
    
    if (urlToken) {
      localStorage.setItem("token", urlToken);
      setToken(urlToken);
      urlParams.delete("token");
      const remainingQuery = urlParams.toString();
      const cleanUrl = `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", cleanUrl);
    }
    
    const currentToken = urlToken || token;
    fetchUser(currentToken);
  }, []);

  async function fetchUser(authToken: string | null) {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else if (authToken) {
        localStorage.removeItem("token");
        setToken(null);
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string): Promise<User> {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    }
    
    const data = await res.json();
    localStorage.setItem("token", data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  async function register(email: string, password: string, language = "ru"): Promise<User> {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, language }),
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Registration failed");
    }
    
    const data = await res.json();
    localStorage.setItem("token", data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    if (token) {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}
