-- ENUM types
CREATE TYPE user_tier AS ENUM ('admin', 'ultra', 'power', 'standard');
CREATE TYPE user_status AS ENUM ('pending', 'approved', 'rejected');

-- user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  tier user_tier NOT NULL DEFAULT 'standard',
  status user_status NOT NULL DEFAULT 'pending',
  credits_remaining INTEGER NOT NULL DEFAULT 20,
  credits_reset_date DATE NOT NULL DEFAULT (DATE_TRUNC('month', NOW()) + INTERVAL '1 month'),
  invite_code_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- invite_codes table
CREATE TABLE IF NOT EXISTS public.invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  tier user_tier NOT NULL DEFAULT 'standard',
  created_by UUID REFERENCES auth.users(id),
  used_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS on user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own_profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own display_name only
CREATE POLICY "users_update_own_name" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admin can read all profiles
CREATE POLICY "admin_read_all_profiles" ON public.user_profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND tier = 'admin'
    )
  );

-- RLS on invite_codes
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

-- Admin can do everything with invite_codes
CREATE POLICY "admin_manage_invite_codes" ON public.invite_codes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND tier = 'admin'
    )
  );

-- Anyone can read a code to validate it (for registration)
CREATE POLICY "anyone_read_invite_code" ON public.invite_codes
  FOR SELECT USING (TRUE);

-- Function: auto-create user_profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_invite_code TEXT;
  v_code_record RECORD;
  v_tier user_tier := 'standard';
  v_status user_status := 'pending';
  v_credits INTEGER := 20;
BEGIN
  -- Check if invite code was passed in raw_user_meta_data
  v_invite_code := NEW.raw_user_meta_data->>'invite_code';

  IF v_invite_code IS NOT NULL AND v_invite_code != '' THEN
    -- Look up the code
    SELECT * INTO v_code_record
    FROM public.invite_codes
    WHERE code = v_invite_code
      AND used_by IS NULL
      AND revoked = FALSE
      AND expires_at > NOW();

    IF FOUND THEN
      -- Valid code: set tier, approve immediately, set credits
      v_tier := v_code_record.tier;
      v_status := 'approved';
      v_credits := CASE v_code_record.tier
        WHEN 'standard' THEN 20
        WHEN 'power' THEN 50
        WHEN 'ultra' THEN 9999
        WHEN 'admin' THEN 9999
        ELSE 20
      END;

      -- Mark code as used
      UPDATE public.invite_codes
      SET used_by = NEW.id, used_at = NOW()
      WHERE code = v_invite_code;
    END IF;
  END IF;

  -- Insert profile
  INSERT INTO public.user_profiles (id, email, tier, status, credits_remaining, invite_code_used)
  VALUES (NEW.id, NEW.email, v_tier, v_status, v_credits, v_invite_code);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed Leo's profile as admin (run after creating the trigger)
INSERT INTO public.user_profiles (id, email, tier, status, credits_remaining)
VALUES (
  '4a6e1f29-e18b-4fd3-9a7e-cec54501db54',
  'firdausleo@hotmail.com',
  'admin',
  'approved',
  9999
) ON CONFLICT (id) DO UPDATE SET tier = 'admin', status = 'approved', credits_remaining = 9999;

-- Helper function used in RLS policies
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND status = 'approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
