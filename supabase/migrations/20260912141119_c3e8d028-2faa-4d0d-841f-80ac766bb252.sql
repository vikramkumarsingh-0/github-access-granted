CREATE TABLE public.bot_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  label TEXT NOT NULL,
  site_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  secret_ciphertext TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_accounts TO authenticated;
GRANT ALL ON public.bot_accounts TO service_role;
ALTER TABLE public.bot_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own bot accounts" ON public.bot_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.automations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  task TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  bot_account_id UUID REFERENCES public.bot_accounts(id) ON DELETE SET NULL,
  cadence TEXT NOT NULL DEFAULT 'daily',
  run_hour_utc SMALLINT NOT NULL DEFAULT 6,
  run_weekday SMALLINT NOT NULL DEFAULT 1,
  browser TEXT NOT NULL DEFAULT 'chromium',
  max_steps SMALLINT NOT NULL DEFAULT 12,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT ALL ON public.automations TO service_role;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own automations" ON public.automations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.automation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  automation_id UUID REFERENCES public.automations(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL DEFAULT 'running',
  summary TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  trigger TEXT NOT NULL DEFAULT 'manual',
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own automation runs" ON public.automation_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX automations_due_idx ON public.automations (enabled, next_run_at);
CREATE INDEX automation_runs_recent_idx ON public.automation_runs (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER bot_accounts_touch BEFORE UPDATE ON public.bot_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER automations_touch BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();