"use client";

import { useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { getScoreEvolution } from "@/lib/history";
import { cn } from "@/lib/utils";

interface ScoreEvolutionChartProps {
  address: string;
  className?: string;
}

export function ScoreEvolutionChart({ address, className }: ScoreEvolutionChartProps) {
  const evolution = useMemo(() => getScoreEvolution(address), [address]);

  if (evolution.length < 2) {
    return (
      <div className={cn("flex items-center justify-center h-24 text-xs text-foreground-muted", className)}>
        Need 2+ analyses to show trend
      </div>
    );
  }

  const chartData = evolution.map((point) => ({
    timestamp: point.timestamp,
    score: point.score,
    archetype: point.archetype,
  }));

  const minScore = Math.min(...evolution.map(p => p.score));
  const maxScore = Math.max(...evolution.map(p => p.score));
  const scoreRange = maxScore - minScore;
  const yAxisDomain: [number, number] = [
    Math.max(0, minScore - scoreRange * 0.2),
    Math.min(100, maxScore + scoreRange * 0.2),
  ];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const date = new Date(data.timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      return (
        <div className="bg-surface border border-border rounded-lg p-2 shadow-lg">
          <div className="text-xs font-mono text-foreground-muted">{date}</div>
          <div className="text-sm font-bold text-foreground">Score: {data.score.toFixed(1)}</div>
          <div className="text-xs text-foreground-muted">{data.archetype}</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <YAxis 
            domain={yAxisDomain}
            hide
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--signal)"
            strokeWidth={2}
            dot={{
              fill: "var(--signal)",
              r: 3,
              strokeWidth: 0,
            }}
            activeDot={{
              r: 5,
              fill: "var(--signal)",
              stroke: "var(--background)",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex justify-between text-xs text-foreground-muted mt-2">
        <span>{evolution.length} data points</span>
        <span>
          {new Date(evolution[0].timestamp).toLocaleDateString()} -{" "}
          {new Date(evolution[evolution.length - 1].timestamp).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
