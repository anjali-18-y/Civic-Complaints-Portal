ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS quality_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_duplicate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz;

CREATE INDEX IF NOT EXISTS reports_category_created_idx ON public.reports (category, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_status_idx ON public.reports (status);
CREATE INDEX IF NOT EXISTS reports_department_idx ON public.reports (assigned_department);

-- Category -> department routing
CREATE OR REPLACE FUNCTION public.department_for_category(_c public.report_category)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _c
    WHEN 'pothole' THEN 'Public Works (Roads)'
    WHEN 'sidewalk' THEN 'Public Works (Roads)'
    WHEN 'streetlight' THEN 'Electrical Department'
    WHEN 'trash' THEN 'Solid Waste Management'
    WHEN 'drainage' THEN 'Water & Drainage'
    WHEN 'graffiti' THEN 'Parks & Beautification'
    ELSE 'General Administration'
  END
$$;

-- Ingestion validation + transformation
CREATE OR REPLACE FUNCTION public.validate_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  flags text[] := '{}';
  dup_id uuid;
  txt text;
BEGIN
  NEW.title := btrim(regexp_replace(coalesce(NEW.title, ''), '\s+', ' ', 'g'));
  NEW.description := btrim(regexp_replace(coalesce(NEW.description, ''), '\s+', ' ', 'g'));
  NEW.address := nullif(btrim(coalesce(NEW.address, '')), '');

  IF length(NEW.description) < 10 THEN
    RAISE EXCEPTION 'Complaint description is missing or too short' USING ERRCODE = '22023';
  END IF;
  IF length(NEW.title) < 3 THEN
    RAISE EXCEPTION 'Complaint title is missing' USING ERRCODE = '22023';
  END IF;

  -- Location validation
  IF (NEW.latitude IS NULL) <> (NEW.longitude IS NULL)
     OR NEW.latitude NOT BETWEEN -90 AND 90
     OR NEW.longitude NOT BETWEEN -180 AND 180
     OR (NEW.latitude = 0 AND NEW.longitude = 0) THEN
    NEW.latitude := NULL; NEW.longitude := NULL;
    flags := flags || 'invalid_location';
  ELSIF NEW.latitude IS NOT NULL
     AND NOT (NEW.latitude BETWEEN 6 AND 38 AND NEW.longitude BETWEEN 68 AND 98) THEN
    flags := flags || 'location_outside_india';
  ELSIF NEW.latitude IS NULL AND NEW.address IS NULL THEN
    flags := flags || 'missing_location';
  END IF;

  -- Date validation
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_at IS NULL OR NEW.created_at > now() + interval '5 minutes'
       OR NEW.created_at < now() - interval '1 year' THEN
      NEW.created_at := now();
      flags := flags || 'invalid_date';
    END IF;
  END IF;

  -- Category / department
  IF NEW.category IS NULL THEN
    NEW.category := 'other';
    flags := flags || 'missing_category';
  END IF;
  IF NEW.assigned_department IS NULL OR btrim(NEW.assigned_department) = '' THEN
    NEW.assigned_department := public.department_for_category(NEW.category);
  END IF;

  -- Priority normalisation + keyword escalation
  IF NEW.priority IS NULL THEN
    NEW.priority := 'medium';
    flags := flags || 'missing_priority';
  END IF;
  txt := lower(NEW.title || ' ' || NEW.description);
  IF txt ~ '(accident|injur|live wire|electrocut|collapse|fire|sewage overflow|flood)'
     AND NEW.priority <> 'urgent' THEN
    NEW.priority := 'urgent';
    flags := flags || 'priority_escalated';
  ELSIF txt ~ '(danger|school|hospital|children|blocked road)'
     AND NEW.priority IN ('low','medium') THEN
    NEW.priority := 'high';
    flags := flags || 'priority_escalated';
  END IF;

  -- Duplicate detection (same category, ~100m, last 7 days, still open)
  IF TG_OP = 'INSERT' THEN
    SELECT r.id INTO dup_id FROM public.reports r
    WHERE r.category = NEW.category
      AND r.status IN ('pending','in_progress')
      AND r.created_at > now() - interval '7 days'
      AND r.is_duplicate = false
      AND (
        (NEW.latitude IS NOT NULL AND r.latitude IS NOT NULL
          AND abs(r.latitude - NEW.latitude) < 0.001
          AND abs(r.longitude - NEW.longitude) < 0.001)
        OR lower(r.title) = lower(NEW.title)
      )
    ORDER BY r.created_at ASC LIMIT 1;
    IF dup_id IS NOT NULL THEN
      NEW.is_duplicate := true;
      NEW.duplicate_of := dup_id;
      flags := flags || 'duplicate';
    END IF;
    NEW.quality_flags := flags;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_report_before_insert ON public.reports;
CREATE TRIGGER validate_report_before_insert
BEFORE INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.validate_report();

-- Status history
CREATE TABLE public.report_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  old_status public.report_status,
  new_status public.report_status NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.report_status_history TO authenticated;
GRANT ALL ON public.report_status_history TO service_role;
ALTER TABLE public.report_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view all status history" ON public.report_status_history
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Users view history of own reports" ON public.report_status_history
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.reports r WHERE r.id = report_id AND r.user_id = auth.uid()));
CREATE INDEX report_status_history_report_idx ON public.report_status_history (report_id, changed_at);

CREATE OR REPLACE FUNCTION public.track_report_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.report_status_history (report_id, old_status, new_status, changed_by, changed_at)
    VALUES (NEW.id, NULL, NEW.status, auth.uid(), NEW.created_at);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.report_status_history (report_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_resolution_timestamps()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.first_response_at IS NULL THEN
      NEW.first_response_at := now();
    END IF;
    IF NEW.status IN ('resolved','rejected') THEN
      NEW.resolved_at := now();
    ELSE
      NEW.resolved_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_resolution_timestamps BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.set_resolution_timestamps();
CREATE TRIGGER track_report_status AFTER INSERT OR UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.track_report_status();

-- ETL run log (written by the Python pipeline)
CREATE TABLE public.etl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source text NOT NULL DEFAULT 'python_etl',
  rows_read integer NOT NULL DEFAULT 0,
  rows_loaded integer NOT NULL DEFAULT 0,
  rows_rejected integer NOT NULL DEFAULT 0,
  rows_flagged integer NOT NULL DEFAULT 0,
  issues jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.etl_runs TO authenticated;
GRANT ALL ON public.etl_runs TO service_role;
ALTER TABLE public.etl_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view ETL runs" ON public.etl_runs
  FOR SELECT TO authenticated USING (public.is_admin());

-- Backfill existing rows
UPDATE public.reports SET assigned_department = public.department_for_category(category)
  WHERE assigned_department IS NULL;
UPDATE public.reports SET resolved_at = updated_at
  WHERE status IN ('resolved','rejected') AND resolved_at IS NULL;