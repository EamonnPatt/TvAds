# Northumberland Fitness — TV Ad Screen

A fullscreen ad player for the gym TV that loops ads for local businesses, plus a
password-protected admin panel for managing them. It runs on ordinary cPanel
hosting (GoDaddy): plain PHP and a MySQL database, no Node.

- **TV screen** at `/`: plays the ads fullscreen, in order, forever. Picks up
  changes from the admin panel on its own within 30 seconds, so nobody has to
  touch the TV.
- **Admin panel** at `/admin`: add, edit, reorder, pause and schedule ads, and
  see what the TV is showing right now.

## Where the ads are kept

Everything lives in the MySQL database: the ads, their images and videos, the
screen settings, and what the TV last reported. Nothing is kept in the repo or
in files on the server, so updating the site's files never touches the ads.

- Ads are added with the admin panel's **+ New ad** button. Files go up in 1 MB
  pieces, so PHP's upload limits and MySQL's packet size don't get in the way.
  A piece that fails is retried.
- The largest file you can upload is `max_upload_mb` in `config.php`.
- **Mind the database's size.** Videos take up most of it. The admin panel shows
  how much space the images and videos use, and each ad's file size. GoDaddy
  limits how big a database can get (reportedly 1 GB on some plans). Check your
  plan's limit in cPanel's **Statistics** sidebar. A 30-second 1080p ad is
  usually 5–20 MB.
- The tables are created automatically on the first visit. Their names start
  with `table_prefix` and then `tv_` (for example `bz_tv_ads`), so the ad
  screen can share a database with another site without clashing.

## What an ad can be

| Type | Use it for |
| --- | --- |
| **Image** | A finished ad graphic (JPG/PNG/WebP/GIF). Best at 1920 × 1080. |
| **Video** | An MP4/WebM/MOV commercial. Muted by default; sound can be turned on per ad. |
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

The **Background music** panel in the admin panel plays an internet radio
stream (or a YouTube link) on the TV, behind the ads. While it's on, **every ad
is muted**, even ads set to play sound. Turn it off and those ads get their
sound back.

- It's on by default, playing the Heart 80s radio stream.
- **Use a radio stream on a smart TV.** The TV decodes the stream itself and
  plays it through the browser's Web Audio API, which runs alongside the video
  ads. Samsung TVs can only play one video or audio element at a time, so an
  ordinary audio player would take turns with the videos. The link has to be
  an MP3 stream itself (usually ending in `.mp3` or `/stream`), not the
  station's web page, and the station has to allow other sites to play it
  (most do). If a stream drops, the TV reconnects on its own within a minute.
  Other 80s streams that were tested:
  - `https://0n-80s.radionetz.de/0n-80s.mp3` (0N 80s)
  - `https://makri.cdnstream.com/1898_128` (Hits 80s)
  - `https://premium.shoutcastsolutions.com/radio/8050/256.mp3` (80s Forever)
- **YouTube links only suit a PC or laptop running the TV screen.** On a smart
  TV the YouTube player fights the video ads: the music drops out and the
  YouTube video pops up on screen. On a PC, any video,
  playlist or "Mix" link works. A single video loops; a playlist plays through
  and starts over.
- Browsers don't allow sound until someone clicks the page, and the panel says
  so while it's waiting. **Click the TV screen once** and the music comes on.
  Chrome and Edge remember that click, even across the TV's 12-hourly refresh.
- The panel shows what the TV is playing and warns you if the link won't play
  or if the TV's browser won't allow sound at all. On a PC or laptop used as
  the TV, starting Chrome with `--autoplay-policy=no-user-gesture-required`
  means no click is ever needed.

## Putting it on cPanel (GoDaddy)

The repo has two folders, and they go to two places on the server:

| Folder | Where it goes | What's in it |
| --- | --- | --- |
| `public_html/` | The website's folder | The TV page, the admin panel, and `api.php` |
| `adscreen-private/` | Your home folder, **next to** `public_html` (not inside it) | The PHP code and `config.php` with the passwords |

`api.php` finds `adscreen-private` in any folder above it, so it doesn't matter
how deep the website's folder is.

### 1. The database

In cPanel → **MySQL Databases**, create a database and a user (or use the ones
you already have), and add the user to the database with **ALL PRIVILEGES**. On
GoDaddy both names start with your cPanel username, e.g. `abc123_biztek`. That
full name is what goes in `config.php`.

### 2. config.php

In `adscreen-private`, copy `config.sample.php` to `config.php` and fill in:

- `db_name`, `db_user`, `db_pass`: from step 1. `db_host` stays `localhost`.
- `table_prefix`: any short prefix, e.g. `bz_`.
- `admin_password`: the admin panel's password. Anyone who has it can change
  what the TV shows, so make it long. Changing it logs everyone out.
- `max_upload_mb`: the largest file you can upload.

`config.php` is git-ignored, so the passwords never end up in the repo.

### 3. Pick where the site lives

If the domain's main website is already in `public_html`, give the ad screen
its own spot so the two don't overwrite each other:

- **A subdomain** (tidiest): cPanel → **Domains** → create e.g.
  `tv.yourdomain.com`. cPanel shows the folder it made for it (e.g.
  `public_html/tv.yourdomain.com`). That's the website's folder.
- **A subfolder**: e.g. `public_html/tv`, which opens at `yourdomain.com/tv/`.

Don't call the folder or subdomain **ads**. TV browsers with ad blocking
(Samsung's, for one) block addresses with "ads" in them.

### 4. Upload

In cPanel → **File Manager** (or over FTP):

1. Upload the `adscreen-private` folder into your home folder (the one that
   holds `public_html`), with the `config.php` from step 2 in it.
2. Upload the **contents** of the repo's `public_html` folder into the
   website's folder from step 3. That includes `.htaccess`. File Manager hides
   files starting with a dot unless **Settings → Show Hidden Files** is ticked.

### 5. PHP version

cPanel → **MultiPHP Manager** (or **Select PHP Version**): use PHP 7.4 or newer
(8.x is best). The `pdo_mysql` extension it needs is on by default.

### 6. Check it

- Open `https://<your site>/admin`, log in, and add the ads. The three that used
  to be in the repo's `ads/` folder (`ad1.mp4`, `ad2.mp4`, `ad3.png`) are still
  on the computer this repo was on, just no longer in git. Add them with
  **+ New ad**.
- If something's wrong with `config.php` or the database, the admin panel's
  login screen says what to fix.
- Turn on HTTPS for the site: cPanel → **Domains** → **Force HTTPS Redirect**.
  The TV page can only keep the screen awake over https.

**Updating the site later:** upload the changed files again. `config.php` and
the database stay as they are, so no ads or settings are lost.

## Setting up the TV

Any smart TV browser, Fire Stick, Chromecast-with-Google-TV, mini PC, or old
laptop plugged in over HDMI will work. Point its browser at the site's address
and click once to go fullscreen.

- Turn off the TV's/device's sleep and screensaver settings. The page asks the
  browser to keep the screen awake, but that only works over https.
- The screen never goes black between ads: the current ad stays up until the
  next one has loaded. If the internet drops, it keeps looping the ads it has
  cached (skipping any it can't load), and it reloads itself every 12 hours.
- The admin panel's top bar shows whether the TV is on and what it's showing.

## Running it on your own computer

You need PHP 7.4+ with `pdo_mysql` and a MySQL or MariaDB server. Put the
database details in `adscreen-private/config.php`, then:

```
php -S localhost:8000 -t public_html
```

- TV: open `http://localhost:8000` and click once. That goes fullscreen and
  allows sound for ads that have it turned on.
- Admin: open `http://localhost:8000/admin.html`. The short `/admin` address
  comes from `.htaccess`, which only the real server reads.

## Project structure

```
public_html/         Goes in the website's folder
  index.html           TV screen
  display.js/.css      Ad player: rotation, transitions, background music, fullscreen, heartbeat
  admin.html           Admin panel
  admin.js/.css        Admin panel logic and styles
  textslide.js/.css    Text-slide renderer shared by the TV and admin preview
  api.php              Every request from the TV and admin panel; hands off to adscreen-private
  .htaccess            /admin address, and makes browsers pick up new versions of the pages
adscreen-private/    Goes next to public_html, outside it
  app.php              The API: login, playlist, uploads, ad edits, TV heartbeat, serving images and videos
  store.php            The database: tables, ads, settings, and files stored in 1 MB pieces
  config.sample.php    Copy to config.php and fill in (config.php is git-ignored)
  .htaccess            Blocks web access in case the folder ends up inside public_html
```
