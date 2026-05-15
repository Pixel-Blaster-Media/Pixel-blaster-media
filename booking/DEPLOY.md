# Deploy Guide — Plain English Edition

**For:** the human who owns this business and doesn't write code.
**Time:** ~60 min total, done once.
**Cost:** $0 to start. $25/month sometime next year when you outgrow Supabase's free tier.

You'll go through 9 stages in order. Each one takes 2–15 minutes. **Do them in order** — skipping ahead will cause errors later.

---

## Before you start

Grab these two things and keep them handy:

- A **password manager** of some kind. Apple Passwords, 1Password, Bitwarden, LastPass, an encrypted Notes.app note — anything that's not plain text email or Slack. You'll be storing 5–10 secret values.
- **Your email address** that you want to sign in as admin with.

And set a rule for yourself: **never paste a secret key into this chat, any email, any Slack, or any public doc.** If one ever gets exposed, tell me and we rotate it.

---

## Stage 1 — Supabase (~10 min)

**What Supabase does, one sentence:** it's the filing cabinet that holds every booking, realtor, property, and invoice status for your site, and it handles the "sign in" part of the app.

### 1.1 Create the project

1. Go to **supabase.com** → click **Start your project** → sign up (Google/GitHub is fastest).
2. Click **New project**.
3. Fill in:
   - **Name:** `pixel-blaster-booking`
   - **Database Password:** click the "Generate a password" button → **copy it into your password manager** → check the "I have copied my password" box.
   - **Region:** `East US (Virginia)` (closest to Hamilton with good Vercel pairing)
   - **Pricing Plan:** Free
4. Click **Create new project**. Wait ~2 minutes while it provisions. You'll see a spinner, then a dashboard.

### 1.2 Run the one-paste setup

1. In the left sidebar, click **SQL Editor** (looks like a `>_` icon).
2. Click **+ New query** in the top bar.
3. In a new browser tab, open this file:
   `https://github.com/Pixel-Blaster-Media/Pixel-blaster-media/blob/claude/real-estate-booking-site-X3Kyh/booking/supabase/setup.sql`
4. Click the **Raw** button (top right of the file view) — the page will now show just the plain text.
5. **Select all** (Cmd+A on Mac, Ctrl+A on Windows) → **Copy** (Cmd+C / Ctrl+C).
6. Back in Supabase's SQL Editor, paste the whole thing.
7. **Important:** near the bottom there's a line that says `admin_email text := 'you@example.com';` — change `you@example.com` to your real email (keep the quotes).
8. Click the green **Run** button in the bottom right.
9. Wait ~5 seconds. You should see **"Success. No rows returned"** and a line in the output like `Created admin user you@example.com with id ...`. That means the whole database is set up and your admin account exists.

> **If you see a red error instead:** copy the error message, paste it to me in chat, and I'll tell you what to do. Don't try again on your own — running broken SQL twice can leave the database in a weird state.

### 1.3 Grab the keys

You need to copy three things from Supabase to Vercel in Stage 2. To find them:

1. In Supabase's left sidebar, click the **gear icon** at the bottom → **API**.
2. You'll see a page with three things to copy:
   - **Project URL** — the URL at the top, like `https://abcdefghijk.supabase.co`
   - **Project API keys → anon public** — a long string starting with `eyJ...`. Click the copy icon to grab it.
   - **Project API keys → service_role** — click the **Reveal** button first, then copy. ⚠️ This one is like a master password. Treat it accordingly.
3. Put all three into your password manager, labeled clearly. You'll need them in 30 seconds.

### 1.4 Configure auth URLs (do this now even though it feels premature)

1. Left sidebar → **Authentication** → **URL Configuration**.
2. **Site URL:** put `https://temp.vercel.app` for now. We'll come back and fix this.
3. Save. Leave the tab open — we'll update it after Vercel gives us a real URL.

**Done with Supabase for now.** ✅

---

## Stage 2 — Vercel deploy (~10 min)

**What Vercel does:** it's the computer your website runs on. Like a web host, but free for what you'll need.

### 2.1 Import and configure

1. Go to **vercel.com/new** and sign in with your GitHub account.
2. You'll see a list of your repositories. Click **Import** next to `Pixel-Blaster-Media/Pixel-blaster-media`.
3. **Important setting** — in the configure screen, find **Root Directory** and click **Edit**. Type `booking` and click **Continue**. If you forget this step, the deploy will fail.
4. **Framework Preset** should auto-detect as Next.js. Leave it.

### 2.2 Environment Variables

Scroll down to **Environment Variables**. This is where we tell the app about Supabase.

Add these four, one at a time:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The Project URL from Stage 1.3 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon public key from Stage 1.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role key from Stage 1.3 |
| `NEXT_PUBLIC_APP_URL` | `https://temp.vercel.app` (we'll fix in 2.4) |

For each one: paste the key name into the **Key** box, paste the value into the **Value** box, click **Save** (or the + button).

### 2.3 Deploy

Click the big **Deploy** button at the bottom. Wait ~90 seconds while it builds. You'll see log output scrolling. When you see **🎉 Congratulations!** or a green checkmark, you're live.

### 2.4 Fix the app URL

1. Copy the URL Vercel assigned you. It's shown at the top of the deployment page, something like `https://pixelblastermedia-booking-abc123.vercel.app`.
2. Click **Settings** (top tab) → **Environment Variables** (left sidebar).
3. Find `NEXT_PUBLIC_APP_URL`, click the `...` → **Edit**. Replace `temp.vercel.app` with your real URL. Save.
4. Click **Deployments** (top tab) → click the **...** next to the most recent deployment → **Redeploy** → confirm. Wait ~60 seconds.

### 2.5 Update Supabase with the real URL

Go back to the Supabase tab you left open (URL Configuration).

1. **Site URL:** replace `https://temp.vercel.app` with your real Vercel URL.
2. **Redirect URLs:** paste these two (one per line), replacing with your real URL:
   ```
   https://your-vercel-url.vercel.app/**
   https://your-vercel-url.vercel.app/auth/callback
   ```
3. Save.

### 2.6 Optional — Google / Apple sign-in

Email and password works without this. Do this section when you want the
**Continue with Google** and **Continue with Apple** buttons to work.

In Supabase, go to **Authentication → URL Configuration** and make sure these
redirect URLs are allowed:

```
https://your-vercel-url.vercel.app/**
https://your-vercel-url.vercel.app/auth/callback
http://localhost:3000/**
http://localhost:3000/auth/callback
```

For Google:

1. In Supabase, go to **Authentication → Providers → Google** and copy the
   callback URL shown there. It will look like:
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.
2. In Google Cloud, create an **OAuth Client ID → Web application**.
3. Add that Supabase callback URL under **Authorized redirect URIs**.
4. Copy the Google **Client ID** and **Client Secret** back into Supabase's
   Google provider settings.
5. Enable the provider and save.

For Apple:

1. You need an Apple Developer account.
2. Create/configure a Services ID for web sign-in.
3. Use your Supabase project domain as the website domain and
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` as the return URL.
4. Generate Apple's client secret and paste the Services ID + secret into
   Supabase's Apple provider settings.

Apple's setup is more annoying than Google's and the secret must be rotated
periodically, so Google is the quickest first win.

### 2.7 Smoke test

1. Open your Vercel URL in an incognito window.
2. You should see the Pixel Blaster Booking landing page (teal headline, "Book the shoot. Get everything in one place.")
3. Go to `/auth/sign-in`, enter your admin email, click **Email me a sign-in link**.
4. Check your inbox (and spam folder). You should get a Supabase-branded magic link. Click it.
5. You should land on `/admin/inbox` with an empty "booking requests" list.

**If that works, the foundation is solid.** ✅ You can stop here and still have a working booking system — realtors can submit, you can accept, portal works. Stages 3–7 add nice-to-haves.

> **Troubleshooting:**
> - **"Invalid API key" during deploy** → you didn't set the Root Directory to `booking`. Go back to Settings → General and fix it, then redeploy.
> - **Email never arrives** → check spam. Supabase's default email deliverability is mediocre; Stage 3 (Resend) fixes this permanently.
> - **Magic link says "expired" or "invalid"** → your `NEXT_PUBLIC_APP_URL` doesn't match the actual URL, or you forgot to save the Supabase URL Configuration.

---

## Stage 3 — Resend email (~10 min, optional but recommended)

**What Resend does:** sends the "we got your booking" and "your portal is ready" emails professionally, so they don't end up in spam.

### 3.1 Set up the account

1. Go to **resend.com** → sign up.
2. Left sidebar → **Domains** → **Add Domain** → enter `pixelblastermedia.com` → **Add**.
3. Resend will show you 3–4 DNS records (TXT and MX) to add at your domain registrar. Keep this tab open.

### 3.2 Add DNS records

This is the fiddly bit. You need to log into wherever `pixelblastermedia.com` is registered (probably GoDaddy, Namecheap, Cloudflare, or Google Domains based on how most photographers set up) and add the records.

**If you don't know where your domain is registered:** open a terminal (Mac: Cmd+Space → "Terminal") and type `whois pixelblastermedia.com`. The output will say "Registrar: GoDaddy" or similar.

General steps at any registrar:
1. Log in.
2. Find "DNS settings" or "DNS zone" for your domain.
3. For each record Resend shows you: click "Add record", set the type (TXT or MX), paste the name and value exactly, save.
4. Back in Resend, click the **Verify** button. First check might fail because DNS takes 5–60 min to propagate. If so, wait and retry.

If this feels overwhelming, skip it for now — you can come back to Stage 3 any time. The booking system works without Resend; you just don't get outbound emails.

### 3.3 Get the API key

1. In Resend, left sidebar → **API Keys** → **Create API Key** → name it "Production" → **Create**.
2. Copy the key (starts with `re_...`) into your password manager.

### 3.4 Add to Vercel

Go to Vercel → your project → **Settings → Environment Variables**. Add:

| Key | Value |
|---|---|
| `RESEND_API_KEY` | The `re_...` key from 3.3 |
| `EMAIL_FROM` | `Pixel Blaster Media <bookings@pixelblastermedia.com>` |
| `ADMIN_NOTIFICATION_EMAIL` | `Info@PixelBlasterMedia.com` |

**Redeploy** (Deployments → ... → Redeploy).

---

## Stage 4 — iGuide webhook (~5 min, recommended)

**What this does:** when you publish a tour in iGuide, the booking page updates automatically. Without it, you click a manual "Sync" button after each publish.

### 4.1 Generate a secret

1. Open a terminal (Mac: Cmd+Space → "Terminal").
2. Paste and hit Enter:
   ```
   openssl rand -hex 32
   ```
3. Copy the long string it prints. Save to password manager labeled "iGuide webhook secret."

### 4.2 Add to Vercel

Add env var `IGUIDE_WEBHOOK_SECRET` with that value. Redeploy.

### 4.3 Configure in iGuide portal

Log into your iGuide portal → find the **Webhooks** or **Integrations** or **Developer** section (varies by iGuide version; ask their support if you can't find it).

- **URL:** `https://your-vercel-url.vercel.app/api/integrations/iguide/webhook?secret=YOUR-SECRET-HERE` (replace both placeholders with your real values)
- **Event:** `ready`
- **Save**

---

## Stage 5 — Fotello API key (~5 min, recommended)

**What this does:** when Fotello finishes enhancing your photos, the gallery shows up on the realtor's portal automatically.

### 5.1 Ask Fotello for the key

Reply to Gavin in the Fotello secure chat:

> "Hi Gavin — I'm ready to implement. Could you send over my API key?"

### 5.2 Paste into Vercel

When the key arrives in Fotello's secure chat, **immediately** copy it to your password manager and then straight into Vercel as env var `FOTELLO_API_KEY`. Do not forward it, screenshot it, or paste it into email.

Redeploy.

---

## Stage 6 — QuickBooks (~15 min, recommended for invoicing)

**What this does:** when you click "Create invoice" on a booking, it creates an invoice in your real QuickBooks, emails it to the realtor via QB's native flow, and tracks payment status.

### 6.1 Create the Intuit app

1. Go to **developer.intuit.com** → **Sign In** (use the same login as your QuickBooks).
2. Top-right → **Dashboard**.
3. **+ Create an app** → pick **QuickBooks Online and Payments**.
4. Name it "Pixel Blaster Booking". Check the `com.intuit.quickbooks.accounting` scope box. Click **Create app**.

### 6.2 Configure redirect URI

1. In your new app's dashboard, left sidebar → **Development** (or "Sandbox") → **Keys & OAuth**.
2. Scroll to **Redirect URIs** → **Add URI**. Paste exactly:
   ```
   https://your-vercel-url.vercel.app/api/integrations/quickbooks/callback
   ```
   (use your actual Vercel URL, no trailing slash, all lowercase). Save.
3. Copy the **Client ID** and **Client Secret** that are on the same page. They're generated by Intuit. Save to password manager.

### 6.3 Add to Vercel

| Key | Value |
|---|---|
| `QUICKBOOKS_CLIENT_ID` | From 6.2 |
| `QUICKBOOKS_CLIENT_SECRET` | From 6.2 |
| `QUICKBOOKS_ENVIRONMENT` | `sandbox` |

> Set `sandbox` while testing (uses a fake QB company Intuit provides). When you're confident everything works, come back and change it to `production`, then redo Stages 6.1/6.2 with the production tabs in the Intuit dashboard.

Redeploy.

### 6.4 Connect from admin

1. Sign into your Vercel URL → `/admin/settings/integrations`.
2. Click **Connect QuickBooks**.
3. An Intuit popup appears. Pick your company. Click **Connect**.
4. You'll land back on the settings page with a green "Connected" pill.
5. Pick a **default service item** from the dropdown. If the dropdown is empty, open QuickBooks in another tab → **Sales → Products and Services → New → Service** → create one called "Real Estate Services" → save. Come back and refresh.

---

## Stage 7 — Prices (~5 min, required for invoicing)

1. Sign into your Vercel URL → `/admin/settings/pricing`.
2. For every service and add-on, type the dollar amount. Use your Acuity prices.
3. Any row left at $0 will block invoice creation — you can't accidentally send a blank invoice.
4. Decide on the "Taxable" checkbox (ON for most real-estate services in Ontario).

---

## Stage 8 — End-to-end test (~10 min)

One full dry run to confirm everything's wired up.

### 8.1 Fake a booking

1. Open your Vercel URL in an **incognito window** → `/book`.
2. Fill it out:
   - Pick services (at least Real Estate Photography)
   - Address: "999 Test St"
   - City: Hamilton
   - Your name + a fake but deliverable email (use an alias like `yourname+test@gmail.com` that lands in your inbox)
   - Phone + brokerage optional
3. Submit. You should land on a "Thanks, we got your request" page.

### 8.2 Check you got the email

- Check the inbox for that fake email → should have "We got your booking request" from Pixel Blaster.
- Check your admin inbox (`ADMIN_NOTIFICATION_EMAIL` from Stage 3) → should have a "New booking — 999 Test St" heads-up.

### 8.3 Accept it

1. Back in your regular browser (signed in as admin), go to `/admin/inbox`.
2. Click the new request → review it.
3. Pick a date and time in the **Actions** panel → click **Accept & create booking**.
4. You'll land on the booking detail page.

### 8.4 Check the realtor got their portal email

- Check the fake email inbox again → should have "Your Pixel Blaster shoot is confirmed".
- Click the teal **"Open your portal →"** button in that email.
- You should land on the portal as that fake user, signed in, seeing one listing.

### 8.5 Create a test invoice

1. Back on the admin booking detail, scroll to the **Invoice** section.
2. Click **Create invoice**. You should see it succeed with a link to open in QuickBooks.
3. Click **Open in QuickBooks ↗** — confirm it shows up in your QB Sandbox.

### 8.6 Try iGuide / Fotello (if you have a real one)

1. On the booking detail, paste a real iGuide URL → **Save** → **Sync from iGuide**.
2. You should see two new deliverables appear (virtual tour + floor plan).
3. Go back to the realtor portal for that property → tour should be embedded.

**If all of Stage 8 works, you're in production.** 🎉

---

## Stage 9 — Point your main site at the booking app (~2 min, optional)

Currently `pixelblastermedia.com` has a "Book Now" button pointing at Acuity. When you're happy with everything, swap the link.

This requires editing `index.html` at the root of your repo. Two options:

- **Easy (ask me):** tell me in chat "swap Acuity for Vercel URL" and I'll do it in one edit.
- **DIY:** open `index.html` in GitHub, click the pencil icon, Find & Replace `https://PixelBlaster.as.me/` with your new URL, commit.

---

## After you're deployed: running costs

- **Supabase free tier** (500MB DB, 50K monthly users): you'll hit neither this year. When/if you outgrow it, Pro is $25/month.
- **Vercel hobby plan:** free for your scale.
- **Resend:** 3,000 emails/month free. Should last forever at your volume.
- **QuickBooks / iGuide / Fotello:** whatever you already pay them, no change.

## When things break later

Any error you see, paste it to me with the rough stage number. I'll diagnose. Common ones:

- Realtor says "magic link doesn't work" → check Supabase URL Configuration didn't drift.
- Invoice create fails → check QB's refresh token didn't expire (100 days idle). If so, `/admin/settings/integrations` → Disconnect → Reconnect.
- Fotello gallery shows "in progress" forever → the enhance actually completed but our sync needs a kick. Go to the booking, click Refresh on that enhance row.

---

## What's in the repo vs in this guide

- **Code:** in `booking/` — I wrote it, you don't need to touch it.
- **Deploy steps:** this file.
- **Operations tips:** the main `booking/README.md` has more technical detail if you ever want it.

Questions at any step? Paste a screenshot or the error text to chat. I'll walk you through it.
