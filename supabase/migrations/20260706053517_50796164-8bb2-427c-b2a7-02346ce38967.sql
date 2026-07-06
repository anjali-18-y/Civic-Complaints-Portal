
-- Restrict reports SELECT: owner or admin only, authenticated only
DROP POLICY IF EXISTS "Anyone can view reports" ON public.reports;

CREATE POLICY "Users can view their own reports"
  ON public.reports FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all reports"
  ON public.reports FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE SELECT ON public.reports FROM anon;

-- Storage: restrict reports bucket read to owner or admin
DROP POLICY IF EXISTS "Anyone can view report images" ON storage.objects;

CREATE POLICY "Owners and admins can view report images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'reports' AND (
      owner = auth.uid() OR public.is_admin()
    )
  );

-- Switch is_admin to SECURITY INVOKER so it isn't a definer function callable by anon/authenticated with elevated rights.
-- Users can already SELECT their own row in user_roles, so this still works correctly.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'staff')
  )
$function$;

-- handle_updated_at is a trigger function only; revoke public execute so it isn't exposed via API
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
