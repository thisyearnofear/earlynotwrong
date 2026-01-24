"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Bell,
  BellOff,
  Mail,
  MessageCircle,
  Loader2,
  Check,
  AlertCircle,
  Settings2,
} from "lucide-react";

interface NotificationPreferences {
  email?: string;
  telegramChatId?: string;
  channels: string[];
  minTrustScore: number;
  minClusterSize: number;
  chainFilter: string[];
  maxAlertsPerHour: number;
  isActive: boolean;
}

interface NotificationSettingsProps {
  userAddress: string;
  className?: string;
  compact?: boolean;
}

export function NotificationSettings({
  userAddress,
  className,
  compact = false,
}: NotificationSettingsProps) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [channels, setChannels] = useState<string[]>(["in_app"]);
  const [minTrustScore, setMinTrustScore] = useState(65);
  const [minClusterSize, setMinClusterSize] = useState(3);
  const [chainFilter, setChainFilter] = useState<string[]>([]);
  const [maxAlertsPerHour, setMaxAlertsPerHour] = useState(10);

  useEffect(() => {
    fetchPreferences();
  }, [userAddress]);

  const fetchPreferences = async () => {
    if (!userAddress) return;
    
    setLoading(true);
    try {
      const response = await fetch(
        `/api/user/notifications?address=${userAddress}`
      );
      const data = await response.json();

      if (data.success && data.preferences) {
        const prefs = data.preferences;
        setPreferences(prefs);
        setEmail(prefs.email || "");
        setTelegramChatId(prefs.telegramChatId || "");
        setChannels(prefs.channels || ["in_app"]);
        setMinTrustScore(prefs.minTrustScore || 65);
        setMinClusterSize(prefs.minClusterSize || 3);
        setChainFilter(prefs.chainFilter || []);
        setMaxAlertsPerHour(prefs.maxAlertsPerHour || 10);
      }
    } catch (err) {
      console.error("Failed to fetch preferences:", err);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("/api/user/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress,
          email: email || undefined,
          telegramChatId: telegramChatId || undefined,
          channels,
          minTrustScore,
          minClusterSize,
          chainFilter,
          maxAlertsPerHour,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save preferences");
      }

      setPreferences(data.preferences);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const disableNotifications = async () => {
    setSaving(true);
    try {
      await fetch(`/api/user/notifications?address=${userAddress}`, {
        method: "DELETE",
      });
      setPreferences(null);
      setChannels(["in_app"]);
    } catch (err) {
      console.error("Failed to disable:", err);
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = (channel: string) => {
    if (channels.includes(channel)) {
      setChannels(channels.filter((c) => c !== channel));
    } else {
      setChannels([...channels, channel]);
    }
  };

  const toggleChain = (chain: string) => {
    if (chainFilter.includes(chain)) {
      setChainFilter(chainFilter.filter((c) => c !== chain));
    } else {
      setChainFilter([...chainFilter, chain]);
    }
  };

  if (loading) {
    return (
      <Card className={cn("bg-black/40 border-zinc-800", className)}>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "border-zinc-700 bg-zinc-900/50",
            preferences?.isActive && "border-cyan-500/50 text-cyan-400"
          )}
          onClick={() => {
            // Toggle quick enable/disable or open full settings
          }}
        >
          {preferences?.isActive ? (
            <Bell className="h-4 w-4 mr-1" />
          ) : (
            <BellOff className="h-4 w-4 mr-1" />
          )}
          {preferences?.isActive ? "Alerts On" : "Enable Alerts"}
        </Button>
      </div>
    );
  }

  return (
    <Card className={cn("bg-black/40 border-zinc-800", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <Bell className="h-4 w-4 text-cyan-400" />
          Cluster Alert Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Notification Channels */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-500 font-mono">
            Notification Channels
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "border-zinc-700 text-xs",
                channels.includes("in_app") &&
                  "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
              )}
              onClick={() => toggleChannel("in_app")}
            >
              <Bell className="h-3 w-3 mr-1" />
              In-App
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "border-zinc-700 text-xs",
                channels.includes("email") &&
                  "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
              )}
              onClick={() => toggleChannel("email")}
            >
              <Mail className="h-3 w-3 mr-1" />
              Email
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "border-zinc-700 text-xs",
                channels.includes("telegram") &&
                  "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
              )}
              onClick={() => toggleChannel("telegram")}
            >
              <MessageCircle className="h-3 w-3 mr-1" />
              Telegram
            </Button>
          </div>
        </div>

        {/* Email Input */}
        {channels.includes("email") && (
          <div className="space-y-1">
            <label className="text-xs text-zinc-500 font-mono">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        )}

        {/* Telegram Input */}
        {channels.includes("telegram") && (
          <div className="space-y-1">
            <label className="text-xs text-zinc-500 font-mono">
              Telegram Chat ID
            </label>
            <input
              type="text"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="123456789"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
            <p className="text-xs text-zinc-600">
              Message @EarlyNotWrongBot to get your chat ID
            </p>
          </div>
        )}

        {/* Chain Filter */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-500 font-mono">
            Chains (empty = all)
          </label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "border-zinc-700 text-xs",
                chainFilter.includes("solana") &&
                  "border-purple-500/50 bg-purple-500/10 text-purple-400"
              )}
              onClick={() => toggleChain("solana")}
            >
              ◎ Solana
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "border-zinc-700 text-xs",
                chainFilter.includes("base") &&
                  "border-blue-500/50 bg-blue-500/10 text-blue-400"
              )}
              onClick={() => toggleChain("base")}
            >
              🔵 Base
            </Button>
          </div>
        </div>

        {/* Thresholds */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-zinc-500 font-mono">
              Min Trust Score
            </label>
            <input
              type="number"
              value={minTrustScore}
              onChange={(e) => setMinTrustScore(Number(e.target.value))}
              min={0}
              max={100}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm font-mono text-zinc-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-500 font-mono">
              Min Cluster Size
            </label>
            <input
              type="number"
              value={minClusterSize}
              onChange={(e) => setMinClusterSize(Number(e.target.value))}
              min={2}
              max={10}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm font-mono text-zinc-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-zinc-500 font-mono">
            Max Alerts / Hour
          </label>
          <input
            type="number"
            value={maxAlertsPerHour}
            onChange={(e) => setMaxAlertsPerHour(Number(e.target.value))}
            min={1}
            max={50}
            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm font-mono text-zinc-200 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-green-400 text-xs">
            <Check className="h-3 w-3" />
            Settings saved!
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={savePreferences}
            disabled={saving}
            className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Settings2 className="h-4 w-4 mr-1" />
                Save Settings
              </>
            )}
          </Button>
          {preferences?.isActive && (
            <Button
              variant="outline"
              onClick={disableNotifications}
              disabled={saving}
              className="border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50"
            >
              <BellOff className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
