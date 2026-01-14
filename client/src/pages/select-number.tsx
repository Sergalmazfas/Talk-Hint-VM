import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Phone, ChevronLeft, Loader2 } from "lucide-react";

interface AvailableNumber {
  id: string;
  twilioNumber: string;
  country: string;
}

export default function SelectNumber() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { user, token, isLoading } = useAuth();
  const { toast } = useToast();
  
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const urlParams = new URLSearchParams(searchString);
  const preselectedType = urlParams.get("type") as "personal" | "work" | null;
  
  const [selectedNumber, setSelectedNumber] = useState<string>("");
  const [numberName, setNumberName] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/");
      return;
    }
    if (token) {
      fetchAvailableNumbers();
    }
  }, [isLoading, user, token]);

  async function fetchAvailableNumbers() {
    try {
      const res = await fetch("/api/numbers/available", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableNumbers(data.numbers || []);
        if (data.numbers?.length > 0) {
          setSelectedNumber(data.numbers[0].id);
        }
      }
    } catch (error) {
      console.error("Failed to fetch numbers:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!selectedNumber) {
      toast({ title: "Error", description: "Please select a number", variant: "destructive" });
      return;
    }
    if (!numberName.trim()) {
      toast({ title: "Error", description: "Please enter a name for your number", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/numbers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          numberId: selectedNumber,
          name: numberName,
          type: preselectedType || "personal",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to assign number");
      }

      const { phoneNumber } = await res.json();
      toast({ title: "Success!", description: `Number ${phoneNumber.twilioNumber} is now yours` });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <div className="max-w-2xl mx-auto pt-8">
        <Button
          variant="ghost"
          onClick={() => setLocation("/dashboard")}
          className="text-gray-400 hover:text-white mb-6"
          data-testid="button-back"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 text-white">Get Your Phone Number</h1>
          <p className="text-gray-400">Choose a number from our available pool</p>
        </div>

        {availableNumbers.length === 0 ? (
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="py-12 text-center">
              <Phone className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400 text-lg">No numbers available right now</p>
              <p className="text-gray-500 text-sm mt-2">New numbers will be added soon</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white text-lg">1. Choose Your Number</CardTitle>
                <CardDescription className="text-gray-400">
                  {availableNumbers.length} numbers available
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup value={selectedNumber} onValueChange={setSelectedNumber}>
                  <div className="space-y-2">
                    {availableNumbers.map((num) => (
                      <div 
                        key={num.id} 
                        className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-700/50 transition-colors"
                      >
                        <RadioGroupItem 
                          value={num.id} 
                          id={num.id} 
                          className="border-cyan-500 text-cyan-500" 
                        />
                        <Label 
                          htmlFor={num.id} 
                          className="text-white font-mono text-lg cursor-pointer flex-1"
                        >
                          {num.twilioNumber}
                          <span className="ml-2 text-gray-500 text-sm">({num.country})</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white text-lg">2. Name Your Number</CardTitle>
                <CardDescription className="text-gray-400">
                  Give your number a friendly name
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Input
                  value={numberName}
                  onChange={(e) => setNumberName(e.target.value)}
                  placeholder="e.g. My Main Number, Work Line..."
                  className="bg-gray-700/50 border-gray-600 text-white"
                  data-testid="input-number-name"
                />
              </CardContent>
            </Card>

            <Button
              size="lg"
              onClick={handleSubmit}
              disabled={submitting || !selectedNumber || !numberName.trim()}
              className="w-full bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700"
              data-testid="button-get-number"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Getting your number...
                </>
              ) : (
                <>
                  <Phone className="w-5 h-5 mr-2" />
                  Get This Number
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
