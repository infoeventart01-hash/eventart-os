# EventArt

EventArt is a private event-planning workspace backed by the existing EventArt Airtable base. Authentication is provided by Supabase Auth; passwords are stored only by Supabase and are never stored in Airtable or this repository.

## Required environment variables

Create a plain-text `.env.local` file in the project root for local development. Vinext loads this file into server-side `process.env`. Do not commit `.env.local`.

```dotenv
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TOKEN=your_private_airtable_token
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
EVENTART_OWNER_EMAIL=infoeventart01@gmail.com
EVENTART_APP_URL=http://localhost:3000
EVENTART_PORTAL_SIGNING_SECRET=generate_a_long_random_secret
```

The five variables required specifically for sign-in and Owner initialization are:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)
- `EVENTART_OWNER_EMAIL`
- `EVENTART_APP_URL`

`EVENTART_PORTAL_SIGNING_SECRET` signs private client-portal links. Airtable requires `AIRTABLE_BASE_ID` and `AIRTABLE_TOKEN`. Despite the `NEXT_PUBLIC_` names used by Supabase, EventArt reads these values only in server routes and the server access proxy.

## Configure Supabase

1. Create or open the Supabase project that will own EventArt accounts.
2. In Supabase **SQL Editor**, run [`supabase/migrations/0001_eventart_auth.sql`](supabase/migrations/0001_eventart_auth.sql). This creates only Supabase `profiles` and `user_event_access` tables; it does not alter Airtable.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to the exact `EVENTART_APP_URL` value.
4. Add these redirect URLs:
   - Local: `http://localhost:3000/auth/callback`
   - Production: `https://YOUR-EVENTART-DOMAIN/auth/callback`
5. Copy the project URL, anon/publishable key, and service-role/secret key into the matching environment variables. Never put the service-role key in client code or commit it.
6. Restart `npm run dev` after changing `.env.local`.

## Create the first Owner/Admin securely

1. Confirm `EVENTART_OWNER_EMAIL=infoeventart01@gmail.com` is configured locally and in Cloudflare.
2. In Supabase **Authentication → Users**, choose **Add user → Send invitation**.
3. Invite `infoeventart01@gmail.com`. Do not create or share a password on the user's behalf.
4. Open the invitation from that mailbox and let the Owner choose their own password.
5. Sign in to EventArt with `infoeventart01@gmail.com`.

On the first authenticated request, the server compares the verified Supabase email with `EVENTART_OWNER_EMAIL` and securely upserts that user's Supabase profile as `role = 'owner'` and `active = true`. This also corrects an existing profile that has the wrong role. The Supabase secret key performs this server-only initialization; no password or role is stored in Airtable.

## Password reset, sessions, and logout

- **Forgot Password?** calls Supabase `resetPasswordForEmail` and redirects through `/auth/callback` to `/reset-password`.
- Reset links must be allowed in Supabase Authentication URL Configuration.
- Supabase session cookies are written by the login route and refreshed by the server access proxy, so a valid session persists after refresh.
- **Log Out** calls Supabase `signOut`, clears the session cookies, and returns to `/login`.
- Anonymous visitors are redirected away from management pages and receive `401` from protected APIs.
- `/seating/[eventId]` and `/api/public-seating/[eventId]` remain public and read-only.

## Authentication cookie recovery

EventArt uses the Supabase SSR session cookies only. Current cookies are named `sb-<project-ref>-auth-token` and may be split into numbered chunks such as `.0` and `.1`. Every current session cookie uses `Path=/`, `SameSite=Lax`, no localhost domain, and `Secure` only over HTTPS.

The server automatically expires these obsolete EventArt/Supabase cookie names when encountered: `eventart-auth`, `eventart-session`, `eventart-user`, `sb-access-token`, `sb-refresh-token`, and `supabase-auth-token`. Duplicate current auth cookie names trigger one clean return to `/login` instead of a redirect loop.

If the browser itself rejects a request with HTTP 431 before EventArt can run its cleanup:

1. Open the browser developer tools for the EventArt local site.
2. Open **Application → Storage → Cookies**.
3. Select only `http://localhost` or the EventArt local origin.
4. Delete cookies beginning with `sb-` and the obsolete names listed above.
5. Do not delete cookies belonging to other sites.
6. Close the EventArt tab, restart `npm run dev`, and open `/login` again.

## Cloudflare Worker secrets

Run these commands from the project folder. Wrangler prompts for each value without putting it in shell history:

```powershell
npx wrangler secret put AIRTABLE_BASE_ID
npx wrangler secret put AIRTABLE_TOKEN
npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put EVENTART_OWNER_EMAIL
npx wrangler secret put EVENTART_APP_URL
npx wrangler secret put EVENTART_PORTAL_SIGNING_SECRET
```

For production, `EVENTART_APP_URL` must be the final HTTPS EventArt URL, without a trailing slash. Add its `/auth/callback` URL to the Supabase redirect allow list before testing invitations or password resets.

To verify without deploying:

```powershell
npm run lint
npm test
npm run build
npx wrangler deploy --dry-run
```

Do not run `npm run deploy` until the build, Supabase configuration, secrets, Owner sign-in, password reset, logout, and protected-route tests have all been verified.

## Airtable safety

- Airtable credentials remain server-side.
- Authentication profiles and passwords are not stored in Airtable.
- Authentication setup does not create, rename, or modify Airtable tables or fields.
