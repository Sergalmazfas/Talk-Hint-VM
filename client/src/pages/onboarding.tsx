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

  // SIMPLIFIED: Only one Basic plan
  const basicPlan = products[0]; // First product is Basic $15/mo

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <div className="max-w-4xl mx-auto pt-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4 text-white">Subscribe to TalkHint</h1>
          <p className="text-gray-400 text-lg">Get your personal phone number with AI-powered call assistance</p>
        </div>

        <div className="max-w-md mx-auto">
          {basicPlan ? (
            <Card className="bg-gray-800/50 border-cyan-500 border-2 relative overflow-hidden" data-testid="card-basic-plan">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  Basic
                  <span className="text-3xl font-bold text-cyan-400">
                    ${(basicPlan.prices[0]?.unit_amount || 1500) / 100}
                    <span className="text-sm text-gray-400">/mo</span>
                  </span>
                </CardTitle>
                <CardDescription className="text-gray-400">
                  {basicPlan.description || "AI-powered voice assistant for phone calls"}
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
                    Live calls with AI assistance
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-cyan-400" />
                    Training calls
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-cyan-400" />
                    Real-time translations
                  </li>
                </ul>
                <Button
                  onClick={() => handleCheckout(basicPlan.prices[0]?.id)}
                  disabled={!!checkoutLoading}
                  className="w-full bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700"
                  data-testid="button-checkout-basic"
                >
                  {checkoutLoading === basicPlan.prices[0]?.id ? "Loading..." : "Subscribe Now"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center text-gray-400">Loading plans...</div>
          )}
        </div>

        <div className="text-center mt-8">
          <Button
            variant="ghost"
            onClick={() => setLocation("/dashboard")}
            className="text-gray-400 hover:text-white"
            data-testid="button-skip"
          >
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
}
