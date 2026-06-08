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
