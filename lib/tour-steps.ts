import type { AppRole } from "../src/components/role-badge";

export type TourStep = {
  icon: string;
  iconColor: string;
  title: string;
  body: string;
  tag?: string; // small label above title
};

const USER_STEPS: TourStep[] = [
  {
    icon: "game-controller",
    iconColor: "#06b6d4",
    tag: "Welcome",
    title: "Welcome to ArcadeTracker!",
    body: "Your hub for everything at the arcade — the Monday night skee-ball league, score tracking, teams, tournaments, food, and the community feed.",
  },
  {
    icon: "home",
    iconColor: "#06b6d4",
    tag: "Feed",
    title: "Your Feed",
    body: "Posts from friends and people you follow. Like, react with emojis, comment (@mention people!), bookmark posts to read later, and tap any avatar to visit a profile.\n\nThe Arcade tab carries official announcements.",
  },
  {
    icon: "bowling-ball",
    iconColor: "#f59e0b",
    tag: "League",
    title: "Skee-Ball League",
    body: "8-week seasons, teams of 3, every Monday night. Check in to your lane with a QR code, record every ball, and placements + league points are awarded automatically when all teams finish.\n\nPrizes: $500 / $250 / $100 / $100.",
  },
  {
    icon: "calendar",
    iconColor: "#22c55e",
    tag: "Schedule",
    title: "Schedule & League Night",
    body: "The Leagues tab has everything: the full Monday Night Schedule (who plays at what time), live lane-by-lane scoring on league night, standings, the Title Race, and Player of the Week.\n\nRSVP In/Out on your team page — and if someone's out, request a sub!",
  },
  {
    icon: "stats-chart",
    iconColor: "#a855f7",
    tag: "Stats",
    title: "Serious Stat Tracking",
    body: "Every ball is recorded. Your profile shows weekly averages, shot percentages (how often you hit 100s!), lane stats, clutch ratings, badges, and personal records.\n\nCompare any two players head-to-head, study opponents, and let the AI Coach suggest your team's shooting order.",
  },
  {
    icon: "trophy",
    iconColor: "#f59e0b",
    tag: "Hall of Fame",
    title: "Hall of Fame & Pick'em",
    body: "All-time league records live forever in the Hall of Fame. And every week, play Pick'em — predict the top-scoring team before games start and climb the predictors leaderboard.",
  },
  {
    icon: "people",
    iconColor: "#22c55e",
    tag: "Teams",
    title: "Teams",
    body: "Browse every team and request to join. Creating a team requires the $200 season registration ($50 to join solo — an admin places you).\n\nYour team page has season history, schedules, lineup tools, AI recaps, and team chat.",
  },
  {
    icon: "chatbubbles",
    iconColor: "#06b6d4",
    tag: "Community",
    title: "Forums & Events",
    body: "Discussion boards for every game — post, comment, and run polls. Check What's On for karaoke nights, tournaments, and events (tap I'm Going so the bar knows to expect you).",
  },
  {
    icon: "restaurant",
    iconColor: "#f97316",
    tag: "Food",
    title: "Food & Drinks",
    body: "Browse the menu and order from your phone — no waiting in line.",
  },
  {
    icon: "shield-checkmark",
    iconColor: "#ef4444",
    tag: "Stay Safe",
    title: "A Friendly Community",
    body: "Every post, comment, and profile has a Report option, and you can block anyone to hide their content. Check the Community Guidelines in your settings.\n\nSomething wrong with a league score? Use the Dispute link on your team page within 7 days.",
  },
  {
    icon: "person-circle",
    iconColor: "#06b6d4",
    tag: "Profile",
    title: "Your Profile & Settings",
    body: "Avatar, bio, featured game, league stats card (shareable as an image on the web!). The menu (☰) holds everything else: privacy, 2FA, password, saved posts, My Games history, sub availability, and more.",
  },
  {
    icon: "checkmark-circle",
    iconColor: "#06b6d4",
    tag: "All Set!",
    title: "You're Ready to Play",
    body: "That's the grand tour! Explore at your own pace.\n\nReplay this guide anytime from your profile menu → How to Use This App.",
  },
];

const ADMIN_EXTRA_STEPS: TourStep[] = [
  {
    icon: "shield",
    iconColor: "#f59e0b",
    tag: "Admin Panel",
    title: "Your Admin Powers",
    body: "As an admin you have a dedicated Admin tab in the bottom bar. From there you manage scores, tournaments, the karaoke queue, users, content reports, and support messages — all in one place.",
  },
  {
    icon: "checkmark-done-circle",
    iconColor: "#22c55e",
    tag: "Score Review",
    title: "Score Review",
    body: "Users submit scores with a photo as proof. You review each one — Approve to add it to the leaderboard, or Deny (with a reason) if it looks wrong. Pending scores are flagged on the Admin tab.",
  },
  {
    icon: "bowling-ball",
    iconColor: "#06b6d4",
    tag: "League Ops",
    title: "Running the League",
    body: "The Skeeball tab is mission control: start 8-week seasons, set teams-per-round, generate the full season schedule with rotating time slots, force-finalize short rounds, adjust scores, and resolve score disputes with the ball-by-ball record.",
  },
  {
    icon: "flag",
    iconColor: "#ef4444",
    tag: "Moderation",
    title: "Reports & Broadcasts",
    body: "The Reports tab is your moderation queue — reported posts, comments, forum content, and profiles, with one-tap Remove / Mark Actioned / Dismiss.\n\nNeed to reach everyone? Compose a Broadcast: it banners every feed and pushes to devices.",
  },
  {
    icon: "trophy",
    iconColor: "#f59e0b",
    tag: "Tournaments",
    title: "Tournament Management",
    body: "Approve or deny tournament signup requests, update bracket status, record final placements, and generate QR codes for First Friday sign-ups.",
  },
  {
    icon: "calendar",
    iconColor: "#a855f7",
    tag: "Events",
    title: "Events & First Friday",
    body: "Publish events to the What's On calendar (with RSVP counts) and create monthly First Friday competitions with QR registration.",
  },
  {
    icon: "people",
    iconColor: "#06b6d4",
    tag: "Users & Support",
    title: "Users & Support",
    body: "View all users and roles, manage team registrations and assignments, and answer support messages — a badge appears on the Admin tab when something needs you.",
  },
  {
    icon: "checkmark-circle",
    iconColor: "#f59e0b",
    tag: "Admin: All Set!",
    title: "You're Ready to Manage",
    body: "That covers your admin toolkit. All actions are recorded in the audit log.\n\nYou can replay this guide from your profile menu.",
  },
];

const OWNER_EXTRA_STEPS: TourStep[] = [
  {
    icon: "star",
    iconColor: "#f59e0b",
    tag: "Owner Level",
    title: "Owner-Level Access",
    body: "Your account has the highest access level. You have all admin powers plus the Owner Dashboard (business metrics, trends, top machines) and the ability to promote or demote user roles.",
  },
  {
    icon: "construct",
    iconColor: "#a855f7",
    tag: "Roles",
    title: "Managing Roles",
    body: "In the Users section of the Admin panel, you can change any user's role. Use this carefully — admins can approve scores, moderate content, and run the league on behalf of the venue.",
  },
  {
    icon: "lock-closed",
    iconColor: "#ef4444",
    tag: "Responsibility",
    title: "With Great Power...",
    body: "Owner accounts bypass most restrictions. All admin actions are logged in the audit trail. Only grant admin access to people you fully trust, and never share your login credentials.",
  },
  {
    icon: "checkmark-circle",
    iconColor: "#f59e0b",
    tag: "Owner: All Set!",
    title: "You're in Control",
    body: "You have full control over the platform. Use it wisely!\n\nYou can replay this guide from your profile menu at any time.",
  },
];

export function getTourSteps(role: AppRole): TourStep[] {
  if (role === "owner" || role === "architect") {
    return [...USER_STEPS.slice(0, -1), ...ADMIN_EXTRA_STEPS.slice(0, -1), ...OWNER_EXTRA_STEPS];
  }
  if (role === "admin") {
    return [...USER_STEPS.slice(0, -1), ...ADMIN_EXTRA_STEPS];
  }
  return USER_STEPS;
}

export const TOUR_VERSION = "v3";
export function tourStorageKey(userId: string) {
  return `arcade_tour_${TOUR_VERSION}_${userId}`;
}
