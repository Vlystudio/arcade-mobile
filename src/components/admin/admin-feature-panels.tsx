// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

/**
 * Admin Feature Panels — re-export hub
 *
 * Panel components are pass-through wrappers consumed by src/app/admin.tsx.
 * Feature-specific types and documentation live under src/features/admin/.
 *
 * Type re-exports (for consumers that need them outside admin.tsx):
 */
export type { ReviewTab, ReviewScore, ConfirmAction, StatsData, HealthData } from "../../features/admin/scores";
export type { TournamentRequest, ManageTournament, BracketSlot, BracketScore, BracketGame, BracketGroup, BracketRound } from "../../features/admin/tournaments";
export type { AdminTeam, SupportTicket, SupportMsg, MainTab } from "../../features/admin/shared/types";

import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

type PanelProps = { children: React.ReactNode };

function FeaturePanel({ children }: PanelProps) {
  return <>{children}</>;
}

export function AdminScoreReviewPanel(props: PanelProps) {
  return <FeaturePanel {...props} />;
}

export function TournamentAdminPanel(props: PanelProps) {
  return <FeaturePanel {...props} />;
}

export function ForumModerationPanel(props: PanelProps) {
  return <FeaturePanel {...props} />;
}

export function UserRoleAdminPanel(props: PanelProps) {
  return <FeaturePanel {...props} />;
}

export function AuditSecurityLogsPanel(props: PanelProps) {
  return <FeaturePanel {...props} />;
}

export function VenueAdminPanel(props: PanelProps) {
  return <FeaturePanel {...props} />;
}

export function AdminAccessGate({
  loading,
  isAdmin,
  children,
}: PanelProps & { loading: boolean; isAdmin: boolean }) {
  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#06b6d4" />
      </View>
    );
  }
  if (!isAdmin) return null;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
});
