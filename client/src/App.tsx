import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider,LocalPreviewAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import AccountLogin from "@/pages/account-login";
import { Home, Privacy, Terms, SmsTerms, Support, SmsConsent } from "@/pages/public-site";
import SmsPreferences from "@/pages/sms-preferences";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import AdminDiagnostics from "@/pages/admin-diagnostics";
import VoiceLab from "@/pages/voice-lab";
import SecretaryLab from "@/pages/secretary-lab";
import CallProfiles from "@/pages/call-profiles";
import IncomingSecretary from "@/pages/incoming-secretary";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AccountLogin} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/settings/call-profiles" component={CallProfiles} />
      <Route path="/settings/sms" component={SmsPreferences} />
      <Route path="/incoming-secretary" component={IncomingSecretary} />
      <Route path="/select-number" component={CallProfiles} />
      <Route path="/admin/diagnostics" component={AdminDiagnostics} />
      <Route path="/voice-lab" component={VoiceLab} />
      <Route path="/secretary-lab" component={SecretaryLab} />
      <Route component={NotFound} />
    </Switch>
  );
}

function PublicRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/sms-terms" component={SmsTerms} />
      <Route path="/support" component={Support} />
      <Route path="/sms-consent" component={SmsConsent} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const publicPaths = ["/", "/privacy", "/terms", "/sms-terms", "/support", "/sms-consent"];
  const isPublicPage = publicPaths.includes(path);
  const publicPreview = typeof window !== "undefined" && path === "/incoming-secretary-preview";
  const numberPreview=import.meta.env.DEV&&typeof window!=="undefined"&&
    window.location.pathname==="/settings/call-profiles"&&new URLSearchParams(window.location.search).get("preview")==="1";
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {isPublicPage ? <PublicRouter /> : publicPreview ? <IncomingSecretary /> : numberPreview ? <LocalPreviewAuth><CallProfiles/></LocalPreviewAuth> : <AuthProvider><Router /></AuthProvider>}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
