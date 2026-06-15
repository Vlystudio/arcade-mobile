import type { AppRole } from "../src/components/role-badge";

export type TourStep = {
  icon: string;
  iconColor: string;
  title: string;
  body: string;
  tag?: string;        // small label above title
  route?: string;      // navigate here when this step is shown (interactive walkthrough)
};

// Each step navigates the user to the real screen it describes, so they see
// exactly what's being explained while they read the instructions.
const USER_STEPS: TourStep[] = [
  {
    icon: "game-controller",
    iconColor: "#06b6d4",
    tag: "Welcome",
    title: "Let's take a quick tour",
    body: "I'll walk you through the whole app — uploading scores, teams, tournaments, friends, your profile, and security. Each step takes you to the real screen. Tap Next to begin (or Skip anytime).",
    route: "/",
  },
  {
    icon: "home",
    iconColor: "#06b6d4",
    tag: "Feed",
    title: "This is your Feed",
    body: "Posts from friends and the league. Use the composer at the top to share something. Like, react with emojis, comment, and tap any avatar to open that person's profile. The bell (top-right) is your notifications; the “Arcade” tab holds official announcements.",
    route: "/",
  },
  {
    icon: "trophy",
    iconColor: "#f59e0b",
    tag: "Upload a Score",
    title: "Submit a high score",
    body: "This is the Games screen. Tap any game, then the blue ＋ to submit your score. You'll take a LIVE photo of the machine's display as proof — gallery uploads aren't accepted. An admin reviews it, then it hits the leaderboard.",
    route: "/games",
  },
  {
    icon: "podium",
    iconColor: "#a855f7",
    tag: "Leaderboards",
    title: "See who's on top",
    body: "Top scores for every game. Switch games with the dropdown, and tap the share icon on any score to send it to a friend or copy a share link to brag outside the app.",
    route: "/leaderboard",
  },
  {
    icon: "bowling-ball",
    iconColor: "#f59e0b",
    tag: "League",
    title: "The Skee-Ball League",
    body: "Everything for Monday nights lives in Leagues: live lane-by-lane scoring, standings, the full schedule (who plays when), the Title Race, Player of the Week, and weekly Pick'em — predict the top team before games start and climb the predictors board.",
    route: "/leagues",
  },
  {
    icon: "people",
    iconColor: "#22c55e",
    tag: "Teams",
    title: "Join or create a team",
    body: "Browse every team and tap a team to request to join. Creating your own team needs the $200 season registration (or $50 to register solo — an admin places you on a team). Your team page has chat, schedules, RSVP for Monday, and season history.",
    route: "/teams",
  },
  {
    icon: "git-compare",
    iconColor: "#06b6d4",
    tag: "Compare",
    title: "Head-to-head Compare",
    body: "From Teams, open Compare to pit up to 3 players — or up to 4 teams — side by side: averages, best games, shot breakdowns, and medals. The best number in each row lights up.",
    route: "/teams",
  },
  {
    icon: "person-add",
    iconColor: "#22c55e",
    tag: "Friends",
    title: "Find & add friends",
    body: "Search any username here to look someone up, then send a friend request. Tap anyone to view their profile. Accepted friends show up in your feed and you can DM them from chat.",
    route: "/friends",
  },
  {
    icon: "medal",
    iconColor: "#f59e0b",
    tag: "Tournaments",
    title: "Request a tournament",
    body: "Tap “Request a Tournament” to propose one — pick the game, date, and format, and an admin reviews it. Open tournaments also appear here: tap one to register and track the bracket.",
    route: "/tournaments",
  },
  {
    icon: "chatbubbles",
    iconColor: "#06b6d4",
    tag: "Forums",
    title: "Forums & discussion",
    body: "Community boards for every game. Open a board, tap ＋ to start a thread, add a poll, and comment on others' posts. @mention friends to pull them in.",
    route: "/forums",
  },
  {
    icon: "restaurant",
    iconColor: "#f97316",
    tag: "Food & Karaoke",
    title: "Order food & request songs",
    body: "Browse the menu and order from your phone — no waiting in line. Karaoke runs from the Karaoke screen: search a song and add it to the queue (you can even do this as a guest).",
    route: "/food",
  },
  {
    icon: "create",
    iconColor: "#06b6d4",
    tag: "Your Profile",
    title: "Edit your profile",
    body: "Tap “Edit Profile” to set your avatar, bio, and featured game. Your league stats card lives here too — and on the web you can share it as an image. Tap “Choose Game” to pick which stats everyone sees.",
    route: "/profile",
  },
  {
    icon: "shield-checkmark",
    iconColor: "#22c55e",
    tag: "Security",
    title: "Turn on 2FA",
    body: "Open the ☰ menu (top-right of your profile) → Two-Factor Authentication → Authenticator app, and scan the code with Google or Microsoft Authenticator. It takes a minute and keeps your account locked down — strongly recommended.",
    route: "/profile",
  },
  {
    icon: "settings",
    iconColor: "#a855f7",
    tag: "Settings & Safety",
    title: "Settings, privacy & reporting",
    body: "The ☰ menu also holds privacy toggle, password change, saved posts, your game history, sub availability, the Monday schedule, and the Community Guidelines. Every post, comment, and profile has a Report option, and you can block anyone.",
    route: "/profile",
  },
  {
    icon: "checkmark-circle",
    iconColor: "#06b6d4",
    tag: "All Set!",
    title: "You're ready to play",
    body: "That's the whole app. Replay this walkthrough anytime from your profile menu → How to Use This App. Have fun!",
    route: "/",
  },
];

const ADMIN_EXTRA_STEPS: TourStep[] = [
  {
    icon: "shield",
    iconColor: "#f59e0b",
    tag: "Admin Panel",
    title: "Your admin powers",
    body: "You have a dedicated Admin tab. From here you manage scores, the league, tournaments, karaoke, users, content reports, the beta program, and support — all in one place. Swipe the top tab bar to reach every section.",
    route: "/admin",
  },
  {
    icon: "checkmark-done-circle",
    iconColor: "#22c55e",
    tag: "Score Review",
    title: "Review submitted scores",
    body: "Players submit scores with a live photo. The Reviews tab shows each one — Approve to add it to the leaderboard, or Deny with a reason. Games with a reference photo get an automatic check that flags or auto-denies obvious mismatches.",
    route: "/admin",
  },
  {
    icon: "bowling-ball",
    iconColor: "#06b6d4",
    tag: "League Ops",
    title: "Running the league",
    body: "The Skeeball tab is mission control: start seasons, set teams-per-round, generate the schedule, force-finalize short rounds, clear stuck lanes, and after a tie roll-off use “Set order” to record the finishing order. Reference photos for auto-verify: upload them in the Games tab.",
    route: "/admin",
  },
  {
    icon: "flag",
    iconColor: "#ef4444",
    tag: "Moderation",
    title: "Reports & broadcasts",
    body: "The Reports tab is your moderation queue — reported posts, comments, forums, and profiles with one-tap actions. Need to reach everyone? Compose a Broadcast: it banners every feed and pushes to devices.",
    route: "/admin",
  },
  {
    icon: "checkmark-circle",
    iconColor: "#f59e0b",
    tag: "Admin: All Set!",
    title: "You're ready to manage",
    body: "That covers your toolkit — every action is recorded in the audit log. Replay this guide anytime from your profile menu.",
    route: "/admin",
  },
];

const OWNER_EXTRA_STEPS: TourStep[] = [
  {
    icon: "star",
    iconColor: "#f59e0b",
    tag: "Owner Level",
    title: "Owner-level access",
    body: "Your account has the highest access. You have all admin powers plus the Owner Dashboard — retention, attendance, revenue, feature adoption, the signup funnel, and an activity heatmap.",
    route: "/owner",
  },
  {
    icon: "construct",
    iconColor: "#a855f7",
    tag: "Roles",
    title: "Managing roles",
    body: "In the Admin → Users section you can change any user's role and grant beta-tester access. Use it carefully — admins can approve scores, moderate content, and run the league on the venue's behalf.",
    route: "/owner",
  },
  {
    icon: "checkmark-circle",
    iconColor: "#f59e0b",
    tag: "Owner: All Set!",
    title: "You're in control",
    body: "Full control of the platform — all admin actions are logged. Only grant admin access to people you trust, and never share your login. Replay this guide anytime from your profile menu.",
    route: "/owner",
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

// Bumped to v4 for the interactive navigational walkthrough.
export const TOUR_VERSION = "v4";
export function tourStorageKey(userId: string) {
  return `arcade_tour_${TOUR_VERSION}_${userId}`;
}
