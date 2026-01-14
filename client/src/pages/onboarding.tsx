import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";

interface Product {
  id: string;
  name: string;
  description: string;
  metadata: { tier: string; type: string };
  prices: Array<{
    id: string;
    unit_amount: number;
    currency: string;
  }>;
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { user, token, isLoading } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/");
      return;
    }
    fetchProducts();
  }, [isLoading, user]);

  async function fetchProducts() {
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error("Failed to fetch products:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckout(priceId: string) {
    setCheckoutLoading(priceId);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ priceId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Checkout failed");
      }

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setCheckoutLoading(null);
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const personalPlan = products.find((p) => p.metadata?.tier === "personal");
  const proPlan = products.find((p) => p.metadata?.tier === "pro");

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <div className="max-w-4xl mx-auto pt-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4 text-white">Choose Your Plan</h1>
          <p className="text-gray-400 text-lg">Select a plan to get your personal phone number with AI assistance</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {personalPlan && (
            <Card className="bg-gray-800/50 border-gray-700 relative overflow-hidden" data-testid="card-personal-plan">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  Personal
                  <span className="text-3xl font-bold text-cyan-400">
                    ${(personalPlan.prices[0]?.unit_amount || 0) / 100}
                    <span className="text-sm text-gray-400">/mo</span>
                  </span>
                </CardTitle>
                <CardDescription className="text-gray-400">
                  {personalPlan.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3 text-gray-300">
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-cyan-400" />
                    1 personal phone number
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-cyan-400" />
                    100 minutes/month
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-cyan-400" />
                    Real-time transcription
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-cyan-400" />
                    AI translation hints
                  </li>
                </ul>
                <Button
                  onClick={() => handleCheckout(personalPlan.prices[0]?.id)}
                  disabled={!!checkoutLoading}
                  className="w-full bg-cyan-600 hover:bg-cyan-700"
                  data-testid="button-checkout-personal"
                >
                  {checkoutLoading === personalPlan.prices[0]?.id ? "Loading..." : "Get Started"}
                </Button>
              </CardContent>
            </Card>
          )}

          {proPlan && (
            <Card className="bg-gray-800/50 border-purple-500 border-2 relative overflow-hidden" data-testid="card-pro-plan">
              <Badge className="absolute top-4 right-4 bg-purple-600">Popular</Badge>
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  Pro
                  <span className="text-3xl font-bold text-purple-400">
                    ${(proPlan.prices[0]?.unit_amount || 0) / 100}
                    <span className="text-sm text-gray-400">/mo</span>
                  </span>
                </CardTitle>
                <CardDescription className="text-gray-400">
                  {proPlan.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3 text-gray-300">
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-purple-400" />
                    2 phone numbers (personal + work)
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-purple-400" />
                    Unlimited minutes
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-purple-400" />
                    Custom AI prompts per number
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-purple-400" />
                    Priority support
                  </li>
                </ul>
                <Button
                  onClick={() => handleCheckout(proPlan.prices[0]?.id)}
                  disabled={!!checkoutLoading}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                  data-testid="button-checkout-pro"
                >
                  {checkoutLoading === proPlan.prices[0]?.id ? "Loading..." : "Get Pro"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="text-center mt-8">
          <Button
            variant="ghost"
            onClick={() => setLocation("/dashboard")}
            className="text-gray-400 hover:text-white"
            data-testid="button-skip"
          >
            Skip for now (free trial)
          </Button>
        </div>
      </div>
    </div>
  );
}
