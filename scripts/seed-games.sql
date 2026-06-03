-- Create games, scores, and lanes tables then seed placeholder data
-- Run this in the Supabase SQL Editor

-- ─────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS games (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  type           text NOT NULL,  -- skeeball | pinball | arcade | basketball | airhockey
  description    text,
  machines_count int  DEFAULT 1,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lanes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_number    int  NOT NULL,
  lane_qr_token  text NOT NULL UNIQUE,
  status         text DEFAULT 'available',  -- available | occupied
  game_id        uuid REFERENCES games(id),
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id        uuid REFERENCES games(id),
  lane_id        uuid REFERENCES lanes(id),
  check_in_id    uuid,
  score          int  NOT NULL,
  frame_data     jsonb,
  status         text DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  photo_url      text,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE scores ADD COLUMN IF NOT EXISTS photo_url   text;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS frame_data  jsonb;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS check_in_id uuid;

-- ─────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────

ALTER TABLE games  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lanes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='games'  AND policyname='Anyone can read games')  THEN
    CREATE POLICY "Anyone can read games"  ON games  FOR SELECT USING (true); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lanes'  AND policyname='Anyone can read lanes')  THEN
    CREATE POLICY "Anyone can read lanes"  ON lanes  FOR SELECT USING (true); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scores' AND policyname='Users can insert own scores') THEN
    CREATE POLICY "Users can insert own scores" ON scores FOR INSERT WITH CHECK (auth.uid() = user_id); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scores' AND policyname='Users can read scores') THEN
    CREATE POLICY "Users can read scores" ON scores FOR SELECT USING (status='approved' OR auth.uid()=user_id); END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scores' AND policyname='Users can update own scores') THEN
    CREATE POLICY "Users can update own scores" ON scores FOR UPDATE USING (auth.uid() = user_id); END IF;
END $$;

-- ─────────────────────────────────────────
-- SEED: GAMES
-- ─────────────────────────────────────────

INSERT INTO games (name, type, description, machines_count) VALUES

-- ── Skee-Ball (6 lanes) ──
('Skee-Ball', 'skeeball',
 'Classic alley roller. Roll the ball up the ramp and aim for the high-value center rings. 9 balls per game.',
 6),

-- ── Pinball (15 machines) ──
('Medieval Madness', 'pinball',
 'Battle catapults and dragons in this Williams classic. Destroy all six castles to start Multiball Madness.',
 1),
('The Addams Family', 'pinball',
 'The best-selling pinball machine of all time. Hit the Chair, collect mansion rooms, and start Midnight Madness.',
 1),
('Twilight Zone', 'pinball',
 'Pat Lawlor''s masterpiece. Hit the Power, the Piano, and the Clock to start Lost in the Zone multiball.',
 1),
('Attack from Mars', 'pinball',
 'Destroy the alien saucers and defeat the Martian leader to rule the universe.',
 1),
('Monster Bash', 'pinball',
 'Round up Dracula, Frankenstein, Wolfman, and friends for the greatest monster concert ever.',
 1),
('Funhouse', 'pinball',
 'Rudy the puppet taunts you while you try to put him to sleep. Hit the targets before the clock strikes midnight.',
 1),
('Theatre of Magic', 'pinball',
 'Perform eight spectacular illusions in this Bally classic with its iconic spinning trunk multiball.',
 1),
('Cirqus Voltaire', 'pinball',
 'Join the circus and annoy Voltaire by hitting the animated mane on the center of the playfield.',
 1),
('Creature from the Black Lagoon', 'pinball',
 'Dive into a 1950s drive-in B-movie. Hit combos to rescue Susan from the Creature before time runs out.',
 1),
('Indiana Jones', 'pinball',
 'Three movies, one table. Survive the Map Room, the mine cart, and the boulder. Adventure is your name.',
 1),
('Getaway: High Speed II', 'pinball',
 'Floor it! Hit the supercharger ramps to build speed and activate the freeway multiball.',
 1),
('White Water', 'pinball',
 'Ride the rapids through Insanity Falls. Hit the whirlpool over and over to start Wet Willie''s multiball.',
 1),
('No Good Gofers', 'pinball',
 'Two wisecracking gophers have taken over the golf course. Hit every hole before they destroy the club.',
 1),
('Terminator 2: Judgment Day', 'pinball',
 'Stop Skynet before Judgment Day. Destroy the CPU chip and start the multiball before the T-1000 catches you.',
 1),
('The Machine: Bride of Pin·Bot', 'pinball',
 'Help Pin·Bot find his bride by shooting the visor and completing her face across three challenging modes.',
 1),

-- ── Arcade (20 machines) ──
('Pac-Man', 'arcade',
 'Eat all the dots, dodge the ghosts, and chase the fruit. The original maze runner.',
 1),
('Ms. Pac-Man', 'arcade',
 'The sequel with moving fruit, faster ghosts, and four unique mazes. Widely considered better than the original.',
 1),
('Galaga', 'arcade',
 'Shoot the alien formations before they dive-bomb you. Challenge Stage doubles your firepower.',
 1),
('Donkey Kong', 'arcade',
 'Climb the girders, dodge the barrels, and rescue Pauline. The game that launched a legend.',
 1),
('Street Fighter II: Champion Edition', 'arcade',
 'Choose from 12 World Warriors and dominate the competition. Master the combos or get bodied.',
 2),
('Mortal Kombat II', 'arcade',
 'FINISH HIM. Brutal fatalities, secret characters, and the deepest roster in the series.',
 2),
('NBA Jam: Tournament Edition', 'arcade',
 'He''s on fire! 2-on-2 over-the-top basketball with giant heads, flaming balls, and monster dunks.',
 1),
('Time Crisis II', 'arcade',
 'Grab the gun, use the pedal. Two players, two screens, one mission to stop the GARDA satellite.',
 2),
('House of the Dead 2', 'arcade',
 'Blast your way through hordes of the undead with a partner. A classic light-gun shooter.',
 2),
('Metal Slug', 'arcade',
 'Run, gun, and ride into battle in this legendary SNK run-and-gun. Don''t get fat eating the POW food.',
 1),
('Space Invaders', 'arcade',
 'Defend Earth from the descending alien armada. The game that started the golden age of arcades.',
 1),
('Centipede', 'arcade',
 'The trackball classic. Blast the centipede before it reaches the bottom of the screen.',
 1),
('Asteroids', 'arcade',
 'Thrust, rotate, and shoot your way through an asteroid field. Watch out for the UFOs.',
 1),
('Frogger', 'arcade',
 'Help Frogger cross the highway and the river without becoming roadkill or crocodile food.',
 1),
('Dig Dug', 'arcade',
 'Pump up the enemies until they pop, or squish them with falling rocks. Simple premise, deep strategy.',
 1),
('Tron', 'arcade',
 'Race light cycles, fight tanks, and destroy the MCP. One of the rarest and most sought-after cabinets.',
 1),
('Spy Hunter', 'arcade',
 'Drive the G-6155 Interceptor and eliminate enemy agents. The Peter Gunn theme never gets old.',
 1),
('Teenage Mutant Ninja Turtles', 'arcade',
 'Four-player side-scrolling beat-em-up. Choose your turtle and rescue April from Shredder.',
 1),
('X-Men', 'arcade',
 'Six-player co-op beat-em-up. Pick your X-Man and fight through Magneto''s Brotherhood of Mutants.',
 1),
('Tekken Tag Tournament', 'arcade',
 'Tag in your partner for devastating combo follow-ups. Every fighter on one machine.',
 2)

ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────
-- SEED: 6 SKEE-BALL LANES
-- ─────────────────────────────────────────

WITH skeeball AS (SELECT id FROM games WHERE name = 'Skee-Ball' LIMIT 1)
INSERT INTO lanes (lane_number, lane_qr_token, status, game_id)
SELECT n, 'lane-' || n || '-demo-token', 'available', skeeball.id
FROM skeeball, generate_series(1, 6) AS n
ON CONFLICT (lane_qr_token) DO NOTHING;
