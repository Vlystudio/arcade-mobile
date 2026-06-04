-- ============================================================
-- Content moderation — profanity, hate speech, spam
-- Covers: posts, forums (flag only), team_messages,
--         team_announcements, profiles (username + bio)
-- E2E DMs (messages table) intentionally excluded.
--
-- Run AFTER: rls-policies.sql, security-hardening.sql
-- All statements are idempotent (safe to re-run).
--
-- Admin can manage patterns at any time via:
--   INSERT / UPDATE / DELETE on public.moderation_patterns
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Pattern registry
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moderation_patterns (
  id       serial  PRIMARY KEY,
  pattern  text    NOT NULL UNIQUE,  -- PostgreSQL case-insensitive regex (~*)
  category text    NOT NULL,         -- 'profanity' | 'hate_speech' | 'spam'
  severity int     NOT NULL DEFAULT 2,
    -- 1 = low (spam-like, flag for review)
    -- 2 = medium (profanity, hard block)
    -- 3 = severe (hate speech/slurs, hard block)
  active   boolean NOT NULL DEFAULT true
);

ALTER TABLE moderation_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage moderation_patterns" ON moderation_patterns;
CREATE POLICY "Admins manage moderation_patterns" ON moderation_patterns
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Auth users read moderation_patterns" ON moderation_patterns;
CREATE POLICY "Auth users read moderation_patterns" ON moderation_patterns
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── Seed patterns ─────────────────────────────────────────────
-- Uses \m (word start) and \M (word end) boundaries to reduce false positives.
-- Handles common leet-speak substitutions (i→1/!, u→*, o→0, a→@/4).
-- Patterns are matched against lower(text) using ~* (case-insensitive).

INSERT INTO moderation_patterns (pattern, category, severity) VALUES

-- ── Severe: hate speech / slurs (severity 3) ─────────────────
-- n-slur and variants
('\mn[i1!|]+gg+(a+|e+r+|a+z|e+r+z|e+r+s)?\M',         'hate_speech', 3),
-- f-slur (homophobic) and variants
('\mf[a@4]+gg?(ot+s?|s)?\M',                             'hate_speech', 3),
-- k-slur (antisemitic) and variants
('\mk[i1!]+k[e3]+s?\M',                                   'hate_speech', 3),
-- sp-slur (Hispanic) and variants
('\msp[i1!]+c+s?\M',                                      'hate_speech', 3),
-- ch-slur (Asian) — word-bounded to avoid "chin", "china" in normal use
('\mch[i1!]+n+k+s?\M',                                    'hate_speech', 3),
-- w-slur (Hispanic)
('\mwetbacks?\M',                                          'hate_speech', 3),
-- tr-slur (transphobic)
('\mtr[a@4]nn[y]+s?\M',                                   'hate_speech', 3),
-- r-slur (ableist)
('\mr[e3]+t[a@4]rd+(ed|s)?\M',                           'hate_speech', 3),

-- ── Medium: profanity (severity 2) ──────────────────────────
-- f-word and common derivatives
('\mf+[u*]+c+k+(ing?|e[dr]|s|e[dr]?|h?e[a@4]d|wit|wad|f[a@4]ce)?\M', 'profanity', 2),
-- s-word and common derivatives
('\ms+h+[i1!*]+t+(s|ty|h[o0]le|h[e3][a@4]d|b[a@4]g|faced|less|list)?\M', 'profanity', 2),
-- b-word (female-directed)
('\mb+[i1!*]+tc+h+(es?|ing?|y|sl[a@4]p|[a@4]ss)?\M',   'profanity', 2),
-- c-word
('\mc+[u*]+n+t+(s|y|ish)?\M',                             'profanity', 2),
-- a**hole
('\m[a@4]+s+s+h+[o0*]+l+e+s?\M',                         'profanity', 2),
-- d-word
('\md+[i1!*]+c+k+(s|h[e3][a@4]d|w[a@4]d|f[a@4]ce|ish)?\M', 'profanity', 2),
-- p-word (female anatomy)
('\mp+[u*]+s+s+[yi*]+s?\M',                               'profanity', 2),
-- p-word (urine)
('\mp+[i1!]+ss+(ing?|e[ds]|[e3]r)?\M',                   'profanity', 2),
-- b-word (illegitimate)
('\mb+[a@4]+st[a@4]rd+(s|ly)?\M',                         'profanity', 2),
-- w-word (sex work)
('\mwh+[o0]+r+e+s?\M',                                    'profanity', 2),
-- s-word (excrement, short form)
('\mc+r+[a@4]+p+(s|py|ping?)?\M',                         'profanity', 1),

-- ── Low: spam patterns (severity 1) ──────────────────────────
-- Same character repeated 10+ times
('(.)\1{9,}',                                              'spam', 1),
-- All-caps words 5+ chars (aggressive tone indicator — low severity, flag only)
('\m[A-Z]{5,}\M',                                          'spam', 1)

ON CONFLICT (pattern) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Core moderation function
-- Returns null if clean, jsonb {flagged, category, severity} if matched.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_content_moderation(p_text text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row moderation_patterns%ROWTYPE;
BEGIN
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RETURN NULL;
  END IF;

  -- Check against active patterns, highest severity first
  SELECT * INTO v_row
    FROM moderation_patterns
   WHERE active = true
     AND lower(p_text) ~* pattern
   ORDER BY severity DESC, id ASC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'flagged',   true,
      'category',  v_row.category,
      'severity',  v_row.severity,
      'pattern_id', v_row.id
    );
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.check_content_moderation(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_content_moderation(text) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- Trigger: hard block (raises exception — used on posts,
-- team_messages, team_announcements, profiles)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_content_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_fields text[];
  v_field  text;
  v_value  text;
BEGIN
  -- Determine which text columns to check based on table
  CASE TG_TABLE_NAME
    WHEN 'posts'              THEN v_fields := ARRAY['content'];
    WHEN 'team_messages'      THEN v_fields := ARRAY['content'];
    WHEN 'team_announcements' THEN v_fields := ARRAY['content'];
    WHEN 'profiles'           THEN v_fields := ARRAY['username', 'bio'];
    ELSE v_fields := ARRAY[]::text[];
  END CASE;

  FOREACH v_field IN ARRAY v_fields
  LOOP
    EXECUTE format('SELECT ($1).%I::text', v_field) INTO v_value USING NEW;
    v_result := public.check_content_moderation(v_value);

    IF v_result IS NOT NULL THEN
      IF (v_result->>'category') = 'hate_speech' THEN
        RAISE EXCEPTION 'Your message contains language that is not allowed on this platform. Please revise and try again.'
          USING ERRCODE = 'P0002';
      ELSIF (v_result->>'category') = 'profanity' THEN
        RAISE EXCEPTION 'Your message contains inappropriate language. Please keep it clean!'
          USING ERRCODE = 'P0002';
      ELSE
        RAISE EXCEPTION 'Your message was flagged as spam. Please try again.'
          USING ERRCODE = 'P0002';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── Apply hard-block trigger to relevant tables ───────────────

DROP TRIGGER IF EXISTS moderate_post_content ON posts;
CREATE TRIGGER moderate_post_content
  BEFORE INSERT OR UPDATE OF content ON posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_moderation();

DROP TRIGGER IF EXISTS moderate_team_message ON team_messages;
CREATE TRIGGER moderate_team_message
  BEFORE INSERT OR UPDATE OF content ON team_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_moderation();

DROP TRIGGER IF EXISTS moderate_team_announcement ON team_announcements;
CREATE TRIGGER moderate_team_announcement
  BEFORE INSERT OR UPDATE OF content ON team_announcements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_moderation();

DROP TRIGGER IF EXISTS moderate_profile ON profiles;
CREATE TRIGGER moderate_profile
  BEFORE INSERT OR UPDATE OF username, bio ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_content_moderation();

-- ────────────────────────────────────────────────────────────
-- Forums: soft flag instead of hard block
-- (Admin already reviews all forum posts before publishing —
--  auto_flagged surfaces the issue in the review queue.)
-- ────────────────────────────────────────────────────────────
ALTER TABLE forums
  ADD COLUMN IF NOT EXISTS auto_flagged   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_category  text;

CREATE OR REPLACE FUNCTION public.flag_forum_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_combined text;
BEGIN
  v_combined := coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '');
  v_result   := public.check_content_moderation(v_combined);

  IF v_result IS NOT NULL THEN
    NEW.auto_flagged  := true;
    NEW.flag_category := v_result->>'category';
  ELSE
    NEW.auto_flagged  := false;
    NEW.flag_category := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flag_forum_content ON forums;
CREATE TRIGGER flag_forum_content
  BEFORE INSERT OR UPDATE OF title, description ON forums
  FOR EACH ROW EXECUTE FUNCTION public.flag_forum_content();
