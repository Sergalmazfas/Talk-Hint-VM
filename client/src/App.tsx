import { useAuth, AuthProvider } from "@/lib/auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Router as WouterRouter, Switch, Route, useLocation } from "wouter";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "./lib/queryClient";
import AdminDiagnostics from "@/pages/admin-diagnostics";
import CompanyImport from "@/pages/company-import";
import CallProfiles from "@/pages/call-profiles";
import Dashboard from "@/pages/dashboard";
import IncomingSecretary from "@/pages/incoming-secretary";
import NotFound from "@/pages/not-found";
import Onboarding from "@/pages/onboarding";
import ProjectModel from "@/pages/project-model";
import CompanyPreview from "@/pages/company-preview";
import SecretaryLab from "@/pages/secretary-lab";
import VoiceLab from "@/pages/voice-lab";

function PublicHome() {
  return (
    <main className="min-h-[100dvh] bg-[#f1f3f0] px-6 text-[#23312d]">
      <div className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col justify-between py-8 sm:py-12">
        <div className="text-sm font-semibold tracking-[0.18em] text-[#52655d]">TALKHINT</div>
        <section className="max-w-2xl py-20">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[#73857c]">Private workspace</p>
          <h1 className="text-5xl font-semibold leading-[1.04] tracking-[-0.055em] sm:text-7xl">TalkHint</h1>
          <p className="mt-6 max-w-md text-lg leading-7 text-[#60716a]">The TalkHint workspace is available to its administrators.</p>
          <a
            href="/admin"
            className="mt-9 inline-flex min-h-11 items-center justify-center rounded-md bg-[#29483e] px-5 py-3 text-sm font-semibold text-[#f3f5f1] transition-colors hover:bg-[#1d3930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#29483e]"
          >
            Open admin
          </a>
        </section>
        <footer className="border-t border-[#d3dbd5] pt-5 text-xs tracking-wide text-[#78877f]">TalkHint · Administration</footer>
      </div>
    </main>
  );
}

function AdminLoginFallback() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#eef1ed] px-5">
      <section className="w-full max-w-md rounded-xl border border-[#d5ddd7] bg-[#f8f9f6] p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#74847c]">TalkHint administration</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#253a32]">Sign in to continue</h1>
        <p className="mt-3 text-sm leading-6 text-[#66756e]">Use your administrator Google account to open the workspace.</p>
        <Button className="mt-7 w-full bg-[#29483e] text-white hover:bg-[#1d3930]" onClick={() => { window.location.href = "/api/login"; }}>
          Continue with Google
        </Button>
      </section>
    </main>
  );
}

function AdminGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) setLocation("/login");
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return <div className="min-h-[100dvh] animate-pulse bg-[#202a29]" aria-label="Loading administrator workspace" />;
  }
  if (!user) return <AdminLoginFallback />;
  if (!user.isAdmin) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#eef1ed] px-5">
        <section className="max-w-md rounded-xl border border-[#d5ddd7] bg-[#f8f9f6] p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#74847c]">Restricted area</p>
          <h1 className="mt-4 text-2xl font-semibold text-[#253a32]">Administrator access required</h1>
          <p className="mt-3 text-sm leading-6 text-[#66756e]">This account is not authorized to open the TalkHint admin workspace.</p>
        </section>
      </main>
    );
  }
  return <>{children}</>;
}

function AdminRoutes() {
  return (
    <AdminGate>
      <Switch>
        <Route path="/login" component={AdminLoginFallback} />
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/pricing" component={Onboarding} />
        <Route path="/select-number" component={CallProfiles} />
        <Route path="/settings/call-profiles" component={CallProfiles} />
        <Route path="/incoming-secretary" component={IncomingSecretary} />
        <Route path="/incoming-secretary-preview" component={IncomingSecretary} />
        <Route path="/diagnostics" component={AdminDiagnostics} />
        <Route path="/company-import" component={CompanyImport} />
        <Route path="/project-model" component={ProjectModel} />
        {import.meta.env.DEV && <Route path="/company-preview" component={CompanyPreview} />}
        <Route path="/voice-lab" component={VoiceLab} />
        <Route path="/secretary-lab" component={SecretaryLab} />
        <Route component={NotFound} />
      </Switch>
    </AdminGate>
  );
}

function App() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {pathname === "/" ? (
          <PublicHome />
        ) : (
          <AuthProvider>
            <WouterRouter base="/admin">
              <AdminRoutes />
            </WouterRouter>
          </AuthProvider>
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
