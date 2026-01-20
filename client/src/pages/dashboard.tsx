import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Phone, Settings, LogOut, Plus, Briefcase, Sparkles, Clock, Crown, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface PhoneNumber {
  id: string;
  twilioNumber: string;
  name: string;
  type: string;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, token, isLoading, logout } = useAuth();
  const { toast } = useToast();
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSubscribeDialog, setShowSubscribeDialog] = useState(false);
  const [trialMinutesUsed, setTrialMinutesUsed] = useState(0);

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/");
      return;
    }
    if (token) {
      fetchData();
      checkTrialUsage();
    }
  }, [isLoading, user, token]);

  async function fetchData() {
    try {
      const numbersRes = await fetch("/api/numbers", { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      
      if (numbersRes.ok) {
        const data = await numbersRes.json();
        setNumbers(data.numbers || []);
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  }

  function checkTrialUsage() {
    const storedMinutes = localStorage.getItem('talkhint_trial_minutes');
    const minutes = storedMinutes ? parseFloat(storedMinutes) : 0;
    setTrialMinutesUsed(minutes);
    
    if (minutes >= 5 && user?.plan === "free") {
      setShowSubscribeDialog(true);
    }
  }

  async function handleLogout() {
    await logout();
    setLocation("/");
  }

  function openTalkHint(numberId?: string) {
    const url = numberId ? `/app?number=${numberId}` : "/app";
    window.location.href = url;
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const remainingTrialMinutes = Math.max(0, 5 - trialMinutesUsed);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <header className="border-b border-gray-700 bg-gray-900/50 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
            TalkHint
          </h1>
          <div className="flex items-center gap-4">
            {user?.plan === "free" && (
              <Badge variant="outline" className="text-yellow-400 border-yellow-600 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {remainingTrialMinutes.toFixed(1)} min left
              </Badge>
            )}
            <Badge variant="outline" className="text-gray-300 border-gray-600">
              {user?.plan === "free" ? "Free Trial" : user?.plan}
            </Badge>
            <span className="text-gray-400 text-sm hidden sm:inline">{user?.email}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="text-gray-400 hover:text-white"
              data-testid="button-logout"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Phone className="w-5 h-5 text-cyan-400" />
              My Number
            </h2>
            {numbers.length > 0 && user?.plan === "pro" && (
              <Button
                size="sm"
                onClick={() => setLocation("/select-number")}
                className="bg-cyan-600 hover:bg-cyan-700"
                data-testid="button-add-number"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Number
              </Button>
            )}
          </div>

          {numbers.length === 0 ? (
            <Card className="bg-gray-800/50 border-gray-700 border-dashed" data-testid="card-no-numbers">
              <CardContent className="py-12 text-center">
                <Phone className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                <h3 className="text-white text-lg font-medium mb-2">Get Your Phone Number</h3>
                <p className="text-gray-400 mb-6 max-w-sm mx-auto">
                  Choose a US phone number and start making calls with AI-powered assistance
                </p>
                <Button
                  size="lg"
                  onClick={() => setLocation("/select-number")}
                  className="bg-gradient-to-r from-cyan-500 to-purple-600"
                  data-testid="button-get-number"
                >
                  Get Your Number
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {numbers.map((number) => (
                <Card key={number.id} className="bg-gray-800/50 border-gray-700" data-testid={`card-number-${number.id}`}>
                  <CardContent className="py-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-medium text-lg">{number.name}</p>
                        <p className="text-cyan-400 font-mono text-xl">{number.twilioNumber}</p>
                        <Badge variant="outline" className="mt-2 text-xs border-gray-600 text-gray-400">
                          {number.type === "work" ? "Work" : "Personal"}
                        </Badge>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          size="lg"
                          onClick={() => openTalkHint(number.id)}
                          className="bg-green-600 hover:bg-green-700"
                          data-testid={`button-call-${number.id}`}
                        >
                          <Phone className="w-5 h-5 mr-2" />
                          Start Call
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

{/* FROZEN: Work Number upsell hidden for Basic plan simplification */}
            </div>
          )}
        </section>
      </main>

      <Dialog open={showSubscribeDialog} onOpenChange={setShowSubscribeDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-md">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-r from-cyan-500 to-purple-600 flex items-center justify-center mb-4">
              <Crown className="w-8 h-8 text-white" />
            </div>
            <DialogTitle className="text-xl text-center">Your Trial Has Ended</DialogTitle>
            <DialogDescription className="text-gray-400 text-center">
              You've used your 5 free minutes. Subscribe to continue using TalkHint!
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 my-4">
            <div className="flex items-center gap-3 text-gray-300">
              <Check className="w-5 h-5 text-green-500" />
              <span>Unlimited call minutes</span>
            </div>
            <div className="flex items-center gap-3 text-gray-300">
              <Check className="w-5 h-5 text-green-500" />
              <span>AI-powered assistance</span>
            </div>
            <div className="flex items-center gap-3 text-gray-300">
              <Check className="w-5 h-5 text-green-500" />
              <span>Real-time translations</span>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button 
              className="w-full bg-gradient-to-r from-cyan-500 to-purple-600"
              onClick={() => setLocation("/pricing")}
            >
              Subscribe Now - $15/mo
            </Button>
            <Button 
              variant="ghost" 
              className="w-full text-gray-400"
              onClick={() => setShowSubscribeDialog(false)}
            >
              Maybe Later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
