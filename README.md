# Northumberland Fitness — Waiver Kiosk

A fullscreen, touch-friendly web app for signing the gym liability waiver at
the front desk. On submit it generates a filled-in, signed PDF and emails it to
`contact@northumberlandfitness.com`, then resets for the next person.

Works on desktop (fullscreen browser) today and on an iPad browser later — same app,
no separate build needed.

## 1. Install

```
cd server
npm install
```

## 2. Set up email sending (Resend + your domain)

The app sends email via [Resend](https://resend.com) using your own domain so it can
send from an address like `waiver@northumberlandfitness.com`.

1. Create a free Resend account.
2. In Resend, go to **Domains → Add Domain** and enter `northumberlandfitness.com`.
3. Resend gives you a few DNS records (TXT for verification, DKIM, and usually an
   MX/SPF record). Add those at wherever your domain's DNS is managed (your domain
   registrar or DNS host). This does **not** affect your existing email hosting for
   `contact@northumberlandfitness.com` — it only authorizes Resend to send *from*
   your domain, it doesn't touch how you *receive* mail.
4. Wait for the domain status in Resend to show "Verified" (usually a few minutes to
   a few hours depending on DNS propagation).
5. In Resend, create an **API Key**.
6. Copy `server/.env.example` to `server/.env` and fill in:
   - `RESEND_API_KEY` — the key from step 5
   - `FROM_EMAIL` — e.g. `waiver@northumberlandfitness.com` (any address on the
     verified domain works, doesn't need to be a real mailbox)
   - `TO_EMAIL` — `contact@northumberlandfitness.com` (already the default)

Resend's free tier (3,000 emails/month) is far more than a single waiver kiosk needs.

## 3. Run it

```
cd server
npm start
```

Then open `http://localhost:3000` in a browser and click **Fullscreen** (or press
F11). On the kiosk PC, set the browser to open this page on launch for a true kiosk
setup.

## 4. Using it on an iPad later

The iPad's browser needs to reach this server over the network — running it on
`localhost` only works on the same machine. Two easy options when you're ready:

- **Same Wi-Fi:** run the server on a PC at the gym and open
  `http://<that-pc's-LAN-IP>:3000` on the iPad.
- **Hosted:** deploy the `server/` folder to a small always-on host (e.g. Render,
  Railway, Fly.io) and open its public URL on the iPad. This also means you don't
  need to keep a PC running the server locally.

## Project structure

```
public/        Frontend: waiver text, form, signature pad (vanilla HTML/CSS/JS)
server/        Backend: Express API that generates the signed PDF and emails it
  waiverContent.js  Waiver legal text (shared source of truth for the PDF)
  pdfGenerator.js   Fills in the waiver + signature into a PDF
  emailer.js        Sends the PDF via Resend
  index.js          Express server + /api/submit-waiver endpoint
Waiver.pdf     Original waiver document this app is based on
```

## Editing the waiver text

If the legal text ever changes, update it in **two** places so the on-screen waiver
and the emailed PDF stay in sync:
- `public/index.html` (what signers read on screen)
- `server/waiverContent.js` (what gets baked into the emailed PDF)
