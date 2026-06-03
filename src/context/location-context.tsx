import React, { createContext, useContext, useState } from "react";

export type LocationSlug = "arcade_bar" | "vinyl_hall";

export type AppLocation = {
  slug: LocationSlug;
  name: string;
  shortName: string;
  tagline: string;
  icon: string;
  color: string;
  accentColor: string;
  features: string[];
};

export const LOCATIONS: AppLocation[] = [
  {
    slug: "arcade_bar",
    name: "Arcade Bar",
    shortName: "Arcade Bar",
    tagline: "Skee-Ball · Arcade Games · Bar Bites",
    icon: "game-controller",
    color: "#06b6d4",
    accentColor: "rgba(6,182,212,0.12)",
    features: ["skeeball", "arcade", "bar"],
  },
  {
    slug: "vinyl_hall",
    name: "Vinyl Hall",
    shortName: "Vinyl Hall",
    tagline: "Pool · Vinyl Listening · Full Kitchen",
    icon: "disc",
    color: "#a855f7",
    accentColor: "rgba(168,85,247,0.12)",
    features: ["pool", "vinyl", "kitchen", "bar"],
  },
];

type LocationContextType = {
  location: AppLocation | null;
  setLocation: (loc: AppLocation) => void;
  isArcade: boolean;
  isVinyl: boolean;
};

const LocationContext = createContext<LocationContextType | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<AppLocation | null>(null);

  return (
    <LocationContext.Provider value={{
      location,
      setLocation,
      isArcade: location?.slug === "arcade_bar",
      isVinyl: location?.slug === "vinyl_hall",
    }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocation must be used within LocationProvider");
  return ctx;
}
