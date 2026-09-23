# Northumberland Fitness — TV Ad Screen

A fullscreen ad player for the gym TV that loops ads for local businesses, plus a
password-protected admin panel for managing them.

- **TV screen** at `/`: plays the ads fullscreen, in order, forever. Picks up
  changes from the admin panel on its own within 30 seconds, so nobody has to
  touch the TV.
- **Admin panel** at `/admin`: add, edit, reorder, pause and schedule ads, and
  see what the TV is showing right now.

## Where the ads come from

There are two kinds of ads, and both show up in the admin panel's list:

- **Folder ads**: every image and video in the repo's [`ads/`](ads/) folder
  (tagged "Folder" in the admin panel). New files are added to the end of the
  list, in filename order. Because the files are in the repo, they survive
  restarts on Render's free plan.
- **Uploaded ads**: added through the admin panel's **+ New ad** button.

The **Play folder ads** switch at the top of the list turns all the folder ads
on or off at once. You can edit folder ads like any other ad (name, length,
plays per loop, dates, fit, sound, order, pause). Two things can only be done in
the repo: swapping the file and deleting the ad.

Folder videos start out playing their full length, and folder images start at
10 seconds. Supported files: `.mp4 .webm .mov .jpg .jpeg .png .webp .gif`.

> Your edits to folder ads and the switch setting are saved in `ads.json`. On
> Render's free plan that file is wiped on restart, so the folder ads go back to
> their defaults (the files themselves stay).

## What an ad can be

| Type | Use it for |
| --- | --- |
| **Image** | A finished ad graphic (JPG/PNG/WebP). Best at 1920 × 1080. |
| **Video** | An MP4/WebM commercial. Muted by default; sound can be turned on per ad. |
| **Text slide** | A business with no artwork: name, headline, details and a phone/website line, in their colors. |

Each ad has:

- **Length on screen** in seconds (quick buttons for 10/15/30/60s). Videos can
  instead **play their whole length**.
- **Plays per loop** (1× to 5×). A business paying for a premium spot can get 2×
  the airtime. Extra plays are spread through the loop, not played back to back.
- **Start and end dates**, so an ad goes live and stops by itself when a
  contract starts or ends.
- **Active** on/off, to pause an ad without deleting it.
- **Fit**: fill the screen (crops edges) or show the whole ad with colored bars.
- **Private notes** (contact, what they paid). These never go to the TV.

The dashboard shows the total loop length and how many loops run per hour.
That's handy when telling a business how often their ad airs.

## Background music

The **Background music** panel in the admin panel plays a YouTube video or
playlist on the TV, behind the ads. While it's on, **every ad is muted**, even
ads set to play sound. Turn it off and those ads get their sound back.

- Paste any YouTube link (a video, a playlist, or a "Mix" link like the default
  one) and click **Save link**. A single video loops; a playlist plays through
  and starts over.
- It's on by default, playing an 80s hits mix. Like the other settings, the
  switch and link are saved in `ads.json`, so on Render's free plan a restart
  puts them back to the defaults.
- Browsers don't allow sound until someone clicks the page. Until then the
  music plays muted and the panel says so. **Click the TV screen once** and it
  comes on. Chrome and Edge remember that click, even across the TV's
  12-hourly refresh.
- The panel shows what the TV is playing and warns you if YouTube won't play
  the link (some videos can't be played outside youtube.com) or if the TV's
  browser won't allow sound at all. On a PC or laptop used as the TV, starting
  Chrome with `--autoplay-policy=no-user-gesture-required` means no click is
  ever needed.

## 1. Install

```
cd server
npm install
```

## 2. Set the admin password

Add this line to `server/.env` (see `server/.env.example`):

```
ADMIN_PASSWORD=pick-something-long
```

The admin panel stays locked until this is set. Changing it logs everyone out.

The `RESEND_API_KEY`, `FROM_EMAIL` and `TO_EMAIL` values from the waiver kiosk
are still in `.env` and `render.yaml`. The ad screen doesn't use them, but they
were kept on purpose.

## 3. Run it

```
cd server
npm start
```

- TV: open `http://localhost:3000` and click once. That goes fullscreen and
  allows sound for ads that have it turned on.
- Admin: open `http://localhost:3000/admin`.

## Setting up the TV

Any smart TV browser, Fire Stick, Chromecast-with-Google-TV, mini PC, or old
laptop plugged in over HDMI will work. Point its browser at the site's address
and click once to go fullscreen.

- Turn off the TV's/device's sleep and screensaver settings. The page asks the
  browser to keep the screen awake, but that only works over https (or
  localhost).
- The screen never goes black between ads: the current ad stays up until the
  next one has loaded. If the internet drops, it keeps looping the ads it has
  cached (skipping any it can't load), and it reloads itself every 12 hours.
- The admin panel's top bar shows whether the TV is on and what it's showing.

## Deploying to production (Render)

The repo includes a `render.yaml` blueprint (root directory `server`, build
`npm install`, start `npm start`).

1. Push this repo to GitHub.
2. In Render, **New → Blueprint** and connect the repo.
3. Fill in the environment variables it asks for. `ADMIN_PASSWORD` is the one
   that matters; the Resend ones can stay as they are. Don't set `PORT`;
   Render sets it.
4. Deploy, then open the Render URL on the TV and `<url>/admin` anywhere else.

> **Important: uploaded ads need a persistent disk.** Render's free plan wipes
> the server's files on every deploy and restart, which would delete all
> uploaded ads and settings. To keep them, switch the service to a paid plan
> (Starter), attach a disk, and set `DATA_DIR` to the disk's mount path. The
> commented-out lines in `render.yaml` are already set up for this: uncomment
> the `disk:` block and the `DATA_DIR` variable. The alternative is to run the
> server on an always-on PC at the gym, where files are kept on its own disk.

The TV checks in every 30 seconds, which also stops Render's free tier from
putting the service to sleep while the TV is on.

**Custom domain (optional):** in Render add a Custom Domain (e.g.
`ads.northumberlandfitness.com`), then add the CNAME record Render gives you in
cPanel's **Zone Editor**.

## Project structure

```
public/            Frontend (vanilla HTML/CSS/JS)
  index.html         TV screen
  display.js/.css    Ad player: rotation, transitions, background music, fullscreen, heartbeat
  admin.html         Admin panel
  admin.js/.css      Admin panel logic and styles
  textslide.js/.css     Text-slide renderer shared by the TV and admin preview
server/            Backend (Express)
  index.js           API: login, playlist, ad upload/edit, TV heartbeat
  store.js           Saves ads + settings to DATA_DIR/ads.json
  data/              Default DATA_DIR: ads.json and uploads/ (git-ignored)
render.yaml        Render deployment config
```
