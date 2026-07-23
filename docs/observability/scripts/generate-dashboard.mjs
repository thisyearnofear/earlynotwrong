#!/usr/bin/env node
/**
 * Generate SigNoz v4 dashboard JSON for Early Not Wrong agent metrics.
 * Run: node docs/observability/scripts/generate-dashboard.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../dashboards");
mkdirSync(OUT_DIR, { recursive: true });
const OUT = join(OUT_DIR, "agent-trading-operations.json");

const SERVICE_FILTER = "service.name = 'early-not-wrong-agent'";

function emptyQueryShell() {
  return {
    clickhouse_sql: [{ disabled: false, legend: "", name: "A", query: "" }],
    promql: [{ disabled: false, legend: "", name: "A", query: "" }],
  };
}

function metricQuery({
  queryName = "A",
  metricName,
  timeAggregation = "avg",
  spaceAggregation = "avg",
  groupBy = [],
  legend = "",
  filter = SERVICE_FILTER,
  disabled = false,
}) {
  return {
    queryName,
    dataSource: "metrics",
    disabled,
    expression: queryName,
    aggregations: [
      {
        metricName,
        reduceTo: "avg",
        spaceAggregation,
        temporality: null,
        timeAggregation,
      },
    ],
    filter: { expression: filter },
    filters: { items: [], op: "AND" },
    functions: [],
    groupBy,
    having: { expression: "" },
    legend,
    limit: null,
    orderBy: [],
    stepInterval: 60,
  };
}

function widgetBase(id, title, panelTypes, unit = "") {
  return {
    bucketCount: 30,
    bucketWidth: 0,
    columnUnits: {},
    description: title,
    fillSpans: false,
    id,
    isStacked: false,
    mergeAllActiveQueries: false,
    nullZeroValues: "zero",
    opacity: "1",
    panelTypes,
    selectedLogFields: [
      { dataType: "string", name: "body", type: "" },
      { dataType: "string", name: "timestamp", type: "" },
    ],
    selectedTracesFields: [],
    softMax: 0,
    softMin: 0,
    stackedBarChart: false,
    thresholds: [],
    title,
    yAxisUnit: unit,
  };
}

function valueWidget(id, title, metricName, unit) {
  const w = widgetBase(id, title, "value", unit);
  w.query = {
    queryType: "builder",
    id: `${id}-query`,
    ...emptyQueryShell(),
    builder: {
      queryData: [metricQuery({ metricName, timeAggregation: "latest" })],
      queryFormulas: [],
    },
  };
  return w;
}

function graphWidget(id, title, queries, formulas = [], unit = "") {
  const w = widgetBase(id, title, "graph", unit);
  w.query = {
    queryType: "builder",
    id: `${id}-query`,
    ...emptyQueryShell(),
    builder: {
      queryData: queries,
      queryFormulas: formulas,
    },
  };
  return w;
}

function traceListWidget(id, title) {
  const w = widgetBase(id, title, "list", "");
  w.query = {
    queryType: "builder",
    id: `${id}-query`,
    ...emptyQueryShell(),
    builder: {
      queryData: [
        {
          dataSource: "traces",
          queryName: "A",
          aggregateOperator: "noop",
          aggregateAttribute: { key: "", dataType: "", type: "", isColumn: false },
          filters: { items: [], op: "AND" },
          filter: { expression: `${SERVICE_FILTER} AND name = 'agent.run_cycle'` },
          groupBy: [],
          expression: "A",
          disabled: false,
          having: { expression: "" },
          legend: "",
          limit: 20,
          orderBy: [{ columnName: "timestamp", order: "desc" }],
          stepInterval: 60,
        },
      ],
      queryFormulas: [],
    },
  };
  return w;
}

// Stable widget IDs for reproducible imports
const IDS = {
  headerOps: "enw-sec-ops-0001",
  portfolio: "enw-val-portfolio",
  regime: "enw-val-regime",
  drawdown: "enw-val-drawdown",
  positions: "enw-val-positions",
  headerCycle: "enw-sec-cycle-0002",
  cycleDuration: "enw-graph-cycle-dur",
  trades: "enw-graph-trades",
  anchors: "enw-graph-anchors",
  guardrails: "enw-graph-guardrails",
  headerTraces: "enw-sec-trace-0003",
  traces: "enw-list-traces",
};

const widgets = [
  {
    ...widgetBase(IDS.headerOps, "Portfolio pulse", "row", ""),
    panelTypes: "row",
  },
  valueWidget(IDS.portfolio, "Portfolio (USD)", "agent.portfolio.usd", "currency"),
  valueWidget(IDS.regime, "Regime score", "agent.regime.score", "none"),
  valueWidget(IDS.drawdown, "Drawdown %", "agent.drawdown.percent", "percent"),
  valueWidget(IDS.positions, "Active positions", "agent.positions.active", "none"),
  {
    ...widgetBase(IDS.headerCycle, "Cycle health", "row", ""),
    panelTypes: "row",
  },
  graphWidget(
    IDS.cycleDuration,
    "Cycle duration (ms)",
    [metricQuery({ metricName: "agent.cycle.duration_ms", timeAggregation: "avg" })],
    [],
    "ms",
  ),
  graphWidget(
    IDS.trades,
    "Trade outcomes / cycle",
    [
      metricQuery({
        queryName: "A",
        metricName: "agent.trades.succeeded",
        timeAggregation: "increase",
        legend: "succeeded",
      }),
      metricQuery({
        queryName: "B",
        metricName: "agent.trades.failed",
        timeAggregation: "increase",
        legend: "failed",
        disabled: false,
      }),
    ],
    [],
    "none",
  ),
  graphWidget(
    IDS.anchors,
    "Anchor results by adapter",
    [
      metricQuery({
        metricName: "agent.anchor.results",
        timeAggregation: "increase",
        spaceAggregation: "sum",
        groupBy: [
          {
            dataType: "string",
            id: "anchor.adapter--string--tag--false",
            isColumn: false,
            isJSON: false,
            key: "anchor.adapter",
            type: "tag",
          },
          {
            dataType: "string",
            id: "anchor.status--string--tag--false",
            isColumn: false,
            isJSON: false,
            key: "anchor.status",
            type: "tag",
          },
        ],
        legend: "{{anchor.adapter}} {{anchor.status}}",
      }),
    ],
    [],
    "none",
  ),
  graphWidget(
    IDS.guardrails,
    "Guardrail rejections",
    [
      metricQuery({
        metricName: "agent.guardrails.rejected",
        timeAggregation: "increase",
        legend: "rejected",
      }),
    ],
    [],
    "none",
  ),
  {
    ...widgetBase(IDS.headerTraces, "Trace waterfall", "row", ""),
    panelTypes: "row",
  },
  traceListWidget(IDS.traces, "Recent agent.run_cycle traces"),
];

function layoutItem(i, w, h, x, y) {
  return { h, i, w, x, y, moved: false, static: false };
}

const layout = [
  layoutItem(1, 12, 0, 0, IDS.headerOps),
  layoutItem(3, 3, 0, 1, IDS.portfolio),
  layoutItem(3, 3, 3, 1, IDS.regime),
  layoutItem(3, 3, 6, 1, IDS.drawdown),
  layoutItem(3, 3, 9, 1, IDS.positions),
  layoutItem(1, 12, 0, 4, IDS.headerCycle),
  layoutItem(6, 6, 0, 5, IDS.cycleDuration),
  layoutItem(6, 6, 6, 5, IDS.trades),
  layoutItem(6, 6, 0, 11, IDS.anchors),
  layoutItem(6, 6, 6, 11, IDS.guardrails),
  layoutItem(1, 12, 0, 17, IDS.headerTraces),
  layoutItem(8, 12, 0, 18, IDS.traces),
];

const dashboard = {
  title: "Early Not Wrong — Agent Trading Operations",
  description:
    "Autonomous trading agent: portfolio, conviction regime, guardrails, Mantle/Casper anchors, and run_cycle trace waterfall. Import after OTEL export is enabled.",
  tags: ["early-not-wrong", "agent", "hackathon", "opentelemetry"],
  version: "v4",
  uploadedGrafana: false,
  dotMigrated: true,
  variables: {},
  panelMap: {},
  layout,
  widgets,
};

writeFileSync(OUT, `${JSON.stringify(dashboard, null, 2)}\n`);
console.log(`Wrote ${OUT}`);