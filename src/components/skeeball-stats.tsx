import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import {
  BADGES,
  clutchLabel,
  consistencyLabel,
  type PlayerInsights,
  type PlayerStats,
  type RingCounts,
  type SkeeSeason,
  ringPercents,
  weekLabel,
  weeklyTrend,
} from "../lib/skeeball-stats";

const RING_COLORS: Record<number, string> = {
  10: "#475569",
  20: "#3b82f6",
  30: "#06b6d4",
  40: "#22c55e",
  50: "#f59e0b",
  100: "#ef4444",
};

/** ▲ +12% / ▼ -8% badge comparing the last two weeks. */
export function TrendBadge({ weeks }: { weeks: { avg: number }[] }) {
  const trend = weeklyTrend(weeks);
  if (!trend) return null;
  const color = trend.direction === "up" ? "#22c55e" : trend.direction === "down" ? "#ef4444" : "#888";
  const icon = trend.direction === "up" ? "trending-up" : trend.direction === "down" ? "trending-down" : "remove";
  return (
    <View style={[s.trendBadge, { backgroundColor: `${color}1a`, borderColor: `${color}40` }]}>
      <Ionicons name={icon as any} size={12} color={color} />
      <Text style={[s.trendText, { color }]}>
        {trend.direction === "flat" ? "even" : `${trend.pct}%`} vs last week
      </Text>
    </View>
  );
}

/**
 * Vertical bar chart of weekly values. Pure Views — no chart library.
 * Bars scale to the max value; the best week is highlighted.
 */
export function WeeklyBarChart({
  weeks,
  season,
  color = "#06b6d4",
  compareWeeks,
  compareColor = "#a855f7",
  height = 110,
}: {
  weeks: { week_of: string; avg: number }[];
  season?: SkeeSeason | null;
  color?: string;
  compareWeeks?: { week_of: string; avg: number }[];
  compareColor?: string;
  height?: number;
}) {
  if (weeks.length === 0 && (!compareWeeks || compareWeeks.length === 0)) {
    return <Text style={s.chartEmpty}>No games recorded yet</Text>;
  }

  // Merge week keys from both series so comparisons align by week
  const allWeeks = [...new Set([
    ...weeks.map((w) => w.week_of),
    ...(compareWeeks ?? []).map((w) => w.week_of),
  ])].sort();

  const aMap = Object.fromEntries(weeks.map((w) => [w.week_of, w.avg]));
  const bMap = Object.fromEntries((compareWeeks ?? []).map((w) => [w.week_of, w.avg]));
  const max = Math.max(...allWeeks.map((w) => Math.max(aMap[w] ?? 0, bMap[w] ?? 0)), 1);
  const bestWeek = weeks.reduce((best, w) => (w.avg > (aMap[best] ?? -1) ? w.week_of : best), weeks[0]?.week_of);

  return (
    <View>
      <View style={[s.chartRow, { height }]}>
        {allWeeks.map((weekOf) => {
          const a = aMap[weekOf];
          const b = bMap[weekOf];
          const isBest = !compareWeeks && weekOf === bestWeek && weeks.length > 1;
          return (
            <View key={weekOf} style={s.chartCol}>
              <View style={s.chartBars}>
                {a != null && (
                  <View style={s.barWrap}>
                    <Text style={[s.barValue, { color: isBest ? "#f59e0b" : "#666" }]}>{a}</Text>
                    <View style={[s.bar, {
                      height: Math.max((a / max) * (height - 26), 3),
                      backgroundColor: isBest ? "#f59e0b" : color,
                    }]} />
                  </View>
                )}
                {compareWeeks && (
                  b != null ? (
                    <View style={s.barWrap}>
                      <Text style={[s.barValue, { color: "#666" }]}>{b}</Text>
                      <View style={[s.bar, {
                        height: Math.max((b / max) * (height - 26), 3),
                        backgroundColor: compareColor,
                      }]} />
                    </View>
                  ) : <View style={s.barWrap} />
                )}
                {a == null && <View style={s.barWrap} />}
              </View>
              <Text style={s.chartLabel} numberOfLines={1}>{weekLabel(weekOf, season)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** % of shots landing in each ring (10/20/30/40/50/100) as labeled bars. */
export function RingBreakdown({ rings, compact }: { rings: RingCounts; compact?: boolean }) {
  const rows = ringPercents(rings);
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (total === 0) return <Text style={s.chartEmpty}>No shots recorded yet</Text>;

  return (
    <View style={{ gap: compact ? 5 : 7 }}>
      {rows.map(({ ring, count, pct }) => (
        <View key={ring} style={s.ringRow}>
          <Text style={[s.ringLabel, { color: RING_COLORS[ring] }]}>{ring}</Text>
          <View style={s.ringTrack}>
            <View style={[s.ringFill, { width: `${pct}%` as any, backgroundColor: RING_COLORS[ring] }]} />
          </View>
          <Text style={s.ringPct}>{pct}%</Text>
          {!compact && <Text style={s.ringCount}>({count})</Text>}
        </View>
      ))}
    </View>
  );
}

/** Small labeled chips: percentile, clutch style, consistency. */
export function InsightChips({ insights }: { insights: PlayerInsights }) {
  const clutch = clutchLabel(insights.clutch);
  const consistency = consistencyLabel(insights.consistency);
  const chips: { label: string; color: string; icon: string }[] = [];
  if (insights.percentile != null) {
    chips.push({
      label: `Top ${Math.max(100 - insights.percentile, 1)}%`,
      color: insights.percentile >= 80 ? "#f59e0b" : "#06b6d4",
      icon: "podium-outline",
    });
  }
  if (clutch) chips.push({ label: clutch.label, color: clutch.color, icon: "timer-outline" });
  if (consistency) chips.push({ label: consistency.label, color: consistency.color, icon: "pulse-outline" });
  if (insights.hundos && insights.hundos.count > 0) {
    chips.push({ label: `${insights.hundos.count} hundo${insights.hundos.count === 1 ? "" : "s"}`, color: "#ef4444", icon: "flame-outline" });
  }
  if (chips.length === 0) return null;
  return (
    <View style={s.chipsRow}>
      {chips.map((c) => (
        <View key={c.label} style={[s.insightChip, { backgroundColor: `${c.color}14`, borderColor: `${c.color}38` }]}>
          <Ionicons name={c.icon as any} size={11} color={c.color} />
          <Text style={[s.insightChipText, { color: c.color }]}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Earned badge row. */
export function BadgeRow({ badges }: { badges: string[] }) {
  const earned = badges.filter((b) => BADGES[b]);
  if (earned.length === 0) return null;
  return (
    <View style={s.chipsRow}>
      {earned.map((key) => {
        const b = BADGES[key];
        return (
          <View key={key} style={[s.badge, { borderColor: `${b.color}40`, backgroundColor: `${b.color}10` }]}>
            <Ionicons name={b.icon as any} size={12} color={b.color} />
            <Text style={[s.badgeText, { color: b.color }]}>{b.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Per-lane average rows ("you shoot best on Lane 2"). */
export function LaneStats({ lanes }: { lanes: PlayerInsights["lanes"] }) {
  if (lanes.length < 2) return null;
  const max = Math.max(...lanes.map((l) => l.avg), 1);
  return (
    <View style={{ gap: 5 }}>
      {lanes.map((l, i) => (
        <View key={l.lane_number} style={s.ringRow}>
          <Text style={[s.laneLabel, i === 0 && { color: "#22c55e" }]}>L{l.lane_number}</Text>
          <View style={s.ringTrack}>
            <View style={[s.ringFill, { width: `${Math.round((l.avg / max) * 100)}%` as any, backgroundColor: i === 0 ? "#22c55e" : "#334155" }]} />
          </View>
          <Text style={s.ringPct}>{l.avg}</Text>
          <Text style={s.ringCount}>({l.games})</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The full league stats card used on profiles: this week vs season
 * averages, trend, weekly chart, and ring breakdown.
 */
export function PlayerLeagueCard({
  stats,
  season,
  title = "Skee-Ball League",
  insights,
}: {
  stats: PlayerStats;
  season?: SkeeSeason | null;
  title?: string;
  insights?: PlayerInsights | null;
}) {
  if (stats.totals.games === 0) return null;
  const lastWeek = stats.weeks[stats.weeks.length - 1];

  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.cardTitleRow}>
          <Ionicons name="bowling-ball-outline" size={15} color="#06b6d4" />
          <Text style={s.cardTitle}>{title}</Text>
        </View>
        <TrendBadge weeks={stats.weeks} />
      </View>

      <View style={s.summaryRow}>
        <View style={s.summaryBox}>
          <Text style={s.summaryValue}>{lastWeek?.avg ?? "—"}</Text>
          <Text style={s.summaryLabel}>This Week Avg</Text>
        </View>
        <View style={s.summaryBox}>
          <Text style={[s.summaryValue, { color: "#22c55e" }]}>{stats.totals.avg ?? "—"}</Text>
          <Text style={s.summaryLabel}>{season ? "Season Avg" : "Overall Avg"}</Text>
        </View>
        <View style={s.summaryBox}>
          <Text style={[s.summaryValue, { color: "#f59e0b" }]}>{stats.totals.best ?? "—"}</Text>
          <Text style={s.summaryLabel}>Best Game</Text>
        </View>
        <View style={s.summaryBox}>
          <Text style={[s.summaryValue, { color: "#a855f7" }]}>{stats.totals.games}</Text>
          <Text style={s.summaryLabel}>Games</Text>
        </View>
      </View>

      {insights && <InsightChips insights={insights} />}

      {stats.weeks.length > 0 && (
        <>
          <Text style={s.subLabel}>Weekly Average</Text>
          <WeeklyBarChart weeks={stats.weeks} season={season} />
        </>
      )}

      <Text style={s.subLabel}>Shot Breakdown</Text>
      <RingBreakdown rings={stats.totals.rings} />

      {insights && insights.lanes.length >= 2 && (
        <>
          <Text style={s.subLabel}>Lane Averages</Text>
          <LaneStats lanes={insights.lanes} />
        </>
      )}

      {insights && insights.records && (
        <Text style={s.recordsLine}>
          Records: best game {insights.records.best_game}
          {insights.records.best_week_avg != null && insights.records.best_week_of
            ? ` · best week ${insights.records.best_week_avg} avg (${weekLabel(insights.records.best_week_of, season)})`
            : ""}
        </Text>
      )}

      {insights && <BadgeRow badges={insights.badges} />}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#111", borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: "#1e1e1e", gap: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },

  trendBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1,
  },
  trendText: { fontSize: 11, fontWeight: "800" },

  summaryRow: { flexDirection: "row", gap: 8 },
  summaryBox: {
    flex: 1, backgroundColor: "#0c0c0c", borderRadius: 12, paddingVertical: 10,
    alignItems: "center", borderWidth: 1, borderColor: "#191919",
  },
  summaryValue: { color: "#06b6d4", fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  summaryLabel: { color: "#444", fontSize: 9.5, fontWeight: "700", marginTop: 2, textAlign: "center" },

  subLabel: {
    color: "#3a3a3a", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.2, marginTop: 2,
  },

  chartRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  chartCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" },
  chartBars: { flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 2, width: "100%" },
  barWrap: { flex: 1, maxWidth: 26, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "100%", borderTopLeftRadius: 4, borderTopRightRadius: 4, minWidth: 8 },
  barValue: { fontSize: 9, fontWeight: "800", marginBottom: 2 },
  chartLabel: { color: "#444", fontSize: 9, fontWeight: "600", marginTop: 4 },
  chartEmpty: { color: "#444", fontSize: 12.5, paddingVertical: 8 },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  insightChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1,
  },
  insightChipText: { fontSize: 11, fontWeight: "800" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
  laneLabel: { width: 30, fontSize: 12, fontWeight: "900", textAlign: "right", color: "#666" },
  recordsLine: { color: "#555", fontSize: 11.5, lineHeight: 16 },

  ringRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ringLabel: { width: 30, fontSize: 12, fontWeight: "900", textAlign: "right" },
  ringTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#1a1a1a", overflow: "hidden" },
  ringFill: { height: "100%", borderRadius: 4 },
  ringPct: { width: 36, color: "#888", fontSize: 11.5, fontWeight: "800", textAlign: "right" },
  ringCount: { width: 38, color: "#3a3a3a", fontSize: 10.5 },
});
