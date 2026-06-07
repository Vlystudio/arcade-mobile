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
    title: "Welcome to Arcade!",
    body: "This is your hub for everything happening at the arcade — track scores, join teams, enter tournaments, and stay connected with the community.",
  },
  {
    icon: "home",
    iconColor: "#06b6d4",
    tag: "Feed",
    title: "Your Feed",
    body: "The home screen shows posts from people you follow and your friends. Share moments, post your high scores, and like or comment on what others share.\n\nSwitch to the Arcade tab to see official announcements from staff.",
  },
  {
    icon: "game-controller-outline",
    iconColor: "#a855f7",
    tag: "Games",
    title: "Track Your Scores",
    body: "Browse every game at the arcade. Submit your score after a game and it goes into a review queue — once approved by staff, it appears on your profile and the leaderboard.",
  },
  {
    icon: "people",
    iconColor: "#22c55e",
    tag: "Teams",
    title: "Teams",
    body: "Create or join a team to compete in leagues. As a team member you can track stats together and set time-slot preferences for match nights.\n\nTeam captains manage the roster and can kick or ban players.",
  },
  {
    icon: "trophy",
    iconColor: "#f59e0b",
    tag: "Tournaments",
    title: "Tournaments",
    body: "Request to enter tournaments and track your bracket progress. First Friday events are monthly competitions — keep an eye on the Tourneys tab for upcoming events.",
  },
  {
    icon: "restaurant",
    iconColor: "#f97316",
    tag: "Food",
    title: "Food & Drinks",
    body: "Browse the full menu and build your order right from the app. Add items to your cart and place your order — no need to wait in line.",
  },
  {
    icon: "person-circle",
    iconColor: "#06b6d4",
    tag: "Profile",
    title: "Your Profile",
    body: "Set your avatar, bio, and featured game. Your approved scores, tournament placements, and team membership are all shown here.\n\nToggle private mode to hide your profile from public search.",
  },
  {
    icon: "people-circle",
    iconColor: "#a855f7",
    tag: "Friends & Chat",
    title: "Friends & Direct Messages",
    body: "Send friend requests to other players — accepted friends' posts show up in your feed. Tap the chat bubble icon at the top right to send direct messages or share posts.",
  },
  {
    icon: "stats-chart",
    iconColor: "#22c55e",
    tag: "Leaderboard",
    title: "Leaderboard",
    body: "See who the top players are across all games. Filter by game type to find the best Skeeball, Pinball, or Claw Machine scores. Can you make it to #1?",
  },
  {
    icon: "mic",
    iconColor: "#ec4899",
    tag: "Karaoke",
    title: "Karaoke Nights",
    body: "On karaoke nights, search for a song and add it to the live queue. The TV display screen shows what's playing and what's coming up next — no DJ needed.",
  },
  {
    icon: "checkmark-circle",
    iconColor: "#06b6d4",
    tag: "All Set!",
    title: "You're Ready to Play",
    body: "That covers everything! Explore at your own pace, or tap any section to dive right in.\n\nYou can replay this guide anytime from your Profile screen.",
  },
];

const ADMIN_EXTRA_STEPS: TourStep[] = [
  {
    icon: "shield",
    iconColor: "#f59e0b",
    tag: "Admin Panel",
    title: "Your Admin Powers",
    body: "As an admin you have a dedicated Admin tab in the bottom bar. From there you manage scores, tournaments, the karaoke queue, users, and support messages — all in one place.",
  },
  {
    icon: "checkmark-done-circle",
    iconColor: "#22c55e",
    tag: "Score Review",
    title: "Score Review",
    body: "Users submit scores with a photo as proof. You review each one — Approve to add it to the leaderboard, or Deny (with a reason) if it looks wrong. Pending scores are flagged on the Admin tab.",
  },
  {
    icon: "trophy",
    iconColor: "#f59e0b",
    tag: "Tournaments",
    title: "Tournament Management",
    body: "Approve or deny tournament signup requests, update bracket status (Open → Active → Completed), record final placements, and generate QR codes for First Friday sign-ups.",
  },
  {
    icon: "calendar",
    iconColor: "#a855f7",
    tag: "First Friday",
    title: "First Friday Events",
    body: "Create monthly First Friday events with a name, game, date, and prize pool. Players scan a QR code to register on the night — placements and prizes are entered after the event.",
  },
  {
    icon: "mic",
    iconColor: "#ec4899",
    tag: "Karaoke",
    title: "Karaoke Queue Control",
    body: "Monitor the live karaoke queue in real time. Skip the current song, remove any item from the queue, and view history. The TV display at /karaoke-display auto-advances when a song ends.",
  },
  {
    icon: "people",
    iconColor: "#06b6d4",
    tag: "Users",
    title: "User Management",
    body: "View all registered users, their roles, and activity. Use this to identify issues or look up a specific player when handling a support request.",
  },
  {
    icon: "chatbox",
    iconColor: "#f97316",
    tag: "Support",
    title: "Support Messages",
    body: "Users can send support messages from their profile. You'll see a badge on the Admin tab when a new message arrives — reply directly from the admin panel.",
  },
  {
    icon: "checkmark-circle",
    iconColor: "#f59e0b",
    tag: "Admin: All Set!",
    title: "You're Ready to Manage",
    body: "That covers your admin toolkit. Remember: score decisions are final once approved, and users are notified of denials with your reason.\n\nYou can replay this guide from your Profile screen.",
  },
];

const OWNER_EXTRA_STEPS: TourStep[] = [
  {
    icon: "star",
    iconColor: "#f59e0b",
    tag: "Owner Level",
    title: "Owner-Level Access",
    body: "Your account has the highest access level. You have all admin powers plus the ability to promote or demote user roles — including granting admin privileges to trusted staff.",
  },
  {
    icon: "construct",
    iconColor: "#a855f7",
    tag: "Roles",
    title: "Managing Roles",
    body: "In the Users section of the Admin panel, you can change any user's role. Use this carefully — admins can approve scores and manage tournaments on behalf of the venue.",
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
    body: "You have full control over the platform. Use it wisely!\n\nYou can replay this guide from your Profile screen at any time.",
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

export const TOUR_VERSION = "v2";
export function tourStorageKey(userId: string) {
  return `arcade_tour_${TOUR_VERSION}_${userId}`;
}
