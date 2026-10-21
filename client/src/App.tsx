import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import SelectNumber from "@/pages/select-number";
import AdminDiagnostics from "@/pages/admin-diagnostics";
import VoiceLab from "@/pages/voice-lab";
import SecretaryLab from "@/pages/secretary-lab";
import CallProfiles from "@/pages/call-profiles";
import IncomingSecretary from "@/pages/incoming-secretary";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/settings/call-profiles" component={CallProfiles} />
      <Route path="/incoming-secretary" component={IncomingSecretary} />
      <Route path="/select-number" component={SelectNumber} />
      <Route path="/admin/diagnostics" component={AdminDiagnostics} />
      <Route path="/voice-lab" component={VoiceLab} />
      <Route path="/secretary-lab" component={SecretaryLab} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const publicPreview = typeof window !== "undefined" && window.location.pathname === "/incoming-secretary-preview";
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {publicPreview ? <IncomingSecretary /> : <AuthProvider><Router /></AuthProvider>}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
