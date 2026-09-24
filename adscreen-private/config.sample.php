<?php
/*
 * Ad screen settings.
 *
 * Copy this file to config.php (same folder) and fill it in.
 * config.php holds passwords: it lives in adscreen-private, outside public_html, so it can't be downloaded.
 * It's git-ignored, so it never ends up in the repo.
 */
return [
    // Database: cPanel → MySQL Databases. On GoDaddy the name and user start with your cPanel username,
    // e.g. "abc123_biztek". The user needs ALL PRIVILEGES on the database. The tables are created automatically.
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',
    // Starts the name of every table the ad screen makes (bz_ gives bz_tv_ads, bz_tv_media, ...). Their names
    // all include tv_, so they can share a database with another site without clashing.
    'table_prefix' => 'bz_',

    // Password for the admin panel (yourdomain.com/admin). Leave empty to lock the admin panel. Anyone with it
    // can change what the TV shows, so make it long.
    'admin_password' => '',

    // Largest video or image you can upload, in MB. The files are stored in the database, so mind your
    // hosting's database size limit (the admin panel shows how much space the ads use).
    'max_upload_mb' => 100,
];
