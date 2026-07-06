import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Supabase's `auth.oauth` namespace is in beta and not yet in the generated
// types. Keep a tiny local typed wrapper for the three methods we call.
type OAuthClient = { name?: string; client_id?: string; redirect_uri?: string };
type AuthorizationDetails = {
  client?: OAuthClient;
  scopes?: string[] | string;
  redirect_url?: string;
  redirect_to?: string;
};
type OAuthResult<T> = { data: T | null; error: { message: string } | null };
type OAuthApi = {
  getAuthorizationDetails(id: string): Promise<OAuthResult<AuthorizationDetails>>;
  approveAuthorization(id: string): Promise<OAuthResult<AuthorizationDetails>>;
  denyAuthorization(id: string): Promise<OAuthResult<AuthorizationDetails>>;
};
const authOAuth = (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

const OAuthConsent = () => {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id in the URL.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve the FULL consent URL so /auth returns the user here.
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await authOAuth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data ?? null);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await authOAuth.approveAuthorization(authorizationId)
      : await authOAuth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const scopesRaw = details?.scopes;
  const scopes = Array.isArray(scopesRaw)
    ? scopesRaw
    : typeof scopesRaw === "string"
      ? scopesRaw.split(/\s+/).filter(Boolean)
      : [];

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            Connect {details?.client?.name ?? "an app"} to Civic Connect
          </CardTitle>
          <CardDescription>
            This lets {details?.client?.name ?? "the client"} use Civic Connect as you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : !details ? (
            <p className="text-sm text-muted-foreground">Loading authorization request…</p>
          ) : (
            <>
              {details.client?.redirect_uri && (
                <div className="text-xs text-muted-foreground break-all">
                  Redirect: {details.client.redirect_uri}
                </div>
              )}
              {scopes.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Requested access</p>
                  <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                    {scopes.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                This does not bypass Civic Connect's permissions or backend policies.
              </p>
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() => decide(true)}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => decide(false)}
                >
                  Cancel connection
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default OAuthConsent;