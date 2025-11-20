-- Make reports storage bucket private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'reports';

-- Add write protection policies to user_roles table
-- Block all client-side INSERT operations
CREATE POLICY "Block client-side role inserts" ON public.user_roles
  FOR INSERT
  WITH CHECK (false);

-- Block all client-side UPDATE operations
CREATE POLICY "Block client-side role updates" ON public.user_roles
  FOR UPDATE
  USING (false);

-- Block all client-side DELETE operations
CREATE POLICY "Block client-side role deletes" ON public.user_roles
  FOR DELETE
  USING (false);