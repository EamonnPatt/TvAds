<?php
// Everything the ad screen keeps lives in the MySQL database: the ads, their images and videos, the screen
// settings, and what the TV last reported. The tables are created on the first request.

const SCHEMA_VERSION = 1;
// Images and videos are stored (and uploaded) in 1 MB pieces, which stays under the smallest MySQL packet and
// PHP upload limits a host is likely to have.
const CHUNK_SIZE = 1048576;
// What can be uploaded, and the kind of ad each file makes.
const MEDIA_TYPES = [
    'image/jpeg' => 'image', 'image/png' => 'image', 'image/webp' => 'image', 'image/gif' => 'image',
    'video/mp4' => 'video', 'video/webm' => 'video', 'video/quicktime' => 'video', 'video/x-m4v' => 'video',
];
const DEFAULT_SETTINGS = [
    'transition' => 'fade', // 'fade' | 'slide' | 'none'
    'idleTitle' => 'Northumberland Fitness',
    'idleSubtitle' => 'Advertise your business here: ask at the front desk',
    'musicEnabled' => true, // play musicUrl behind the ads, with every ad muted
    'musicUrl' => 'https://media-ssl.musicradio.com/Heart80sMP3', // Heart 80s radio stream
];

class HttpError extends Exception
{
    public $status;

    public function __construct($status, $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

// ---------- Config and database ----------
function config($key)
{
    static $config = null;
    if ($config === null) {
        if (!is_file(__DIR__ . '/config.php')) {
            throw new HttpError(503, 'config.php is missing. In the adscreen-private folder, copy config.sample.php to config.php and fill it in.');
        }
        $config = (require __DIR__ . '/config.php') + [
            'db_host' => 'localhost', 'db_port' => 3306, 'db_name' => '', 'db_user' => '', 'db_pass' => '',
            'table_prefix' => '', 'admin_password' => '', 'max_upload_mb' => 100,
        ];
        if (!preg_match('/^\w*$/', $config['table_prefix'])) {
            throw new HttpError(503, 'table_prefix in config.php can only use letters, numbers and _.');
        }
    }
    return $config[$key];
}

// A table's name: the configured prefix, then tv_, so the ad screen's tables (e.g. bz_tv_ads) can't clash with
// another site's in a shared database.
function t($name)
{
    return '`' . config('table_prefix') . 'tv_' . $name . '`';
}

function db()
{
    static $pdo = null;
    if ($pdo) return $pdo;
    try {
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', config('db_host'), config('db_port'), config('db_name')),
            config('db_user'),
            config('db_pass'),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
        ensureSchema($pdo);
    } catch (PDOException $e) {
        $pdo = null;
        error_log('Ad screen database error: ' . $e->getMessage());
        throw new HttpError(503, databaseHint($e));
    }
    return $pdo;
}

// Says what to fix in config.php without putting the database's own error (user names and all) on a public page.
function databaseHint(PDOException $e)
{
    $code = (int) ($e->errorInfo[1] ?? $e->getCode());
    switch ($code) {
        case 1045:
            return 'The database refused the login. Check db_user and db_pass in config.php.';
        case 1044:
        case 1049:
            return 'The database in db_name doesn’t exist, or db_user hasn’t been added to it. Check config.php and cPanel → MySQL Databases.';
        case 1142:
            return 'The database user can’t create tables. In cPanel → MySQL Databases, give it ALL PRIVILEGES on the database.';
        case 2002:
        case 2005:
            return 'Can’t reach the database server. Check db_host in config.php (on cPanel it’s usually localhost).';
    }
    return 'The database isn’t working right now (error ' . $code . '). Try again in a minute.';
}

function ensureSchema(PDO $pdo)
{
    try {
        $version = $pdo->query('SELECT value FROM ' . t('settings') . " WHERE name = 'schemaVersion'")->fetchColumn();
        if ((int) $version >= SCHEMA_VERSION) return;
    } catch (PDOException $e) {
        // First run: the tables don't exist yet.
    }
    $options = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    $pdo->exec('CREATE TABLE IF NOT EXISTS ' . t('ads') . " (
        id VARCHAR(32) NOT NULL PRIMARY KEY,
        position INT NOT NULL,
        type VARCHAR(10) NOT NULL,
        title VARCHAR(120) NOT NULL,
        media_id VARCHAR(32) NULL,
        duration SMALLINT UNSIGNED NOT NULL,
        play_full_video TINYINT(1) NOT NULL,
        video_length SMALLINT UNSIGNED NOT NULL,
        muted TINYINT(1) NOT NULL,
        fit VARCHAR(10) NOT NULL,
        background CHAR(7) NOT NULL,
        enabled TINYINT(1) NOT NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        plays_per_loop TINYINT UNSIGNED NOT NULL,
        headline VARCHAR(200) NOT NULL,
        body VARCHAR(600) NOT NULL,
        footer VARCHAR(200) NOT NULL,
        text_color CHAR(7) NOT NULL,
        accent_color CHAR(7) NOT NULL,
        notes TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) $options");
    // An uploaded image or video. ready = 0 while its pieces are still arriving.
    $pdo->exec('CREATE TABLE IF NOT EXISTS ' . t('media') . " (
        id VARCHAR(32) NOT NULL PRIMARY KEY,
        mime VARCHAR(50) NOT NULL,
        size BIGINT UNSIGNED NOT NULL,
        chunk_size INT UNSIGNED NOT NULL,
        ready TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) $options");
    $pdo->exec('CREATE TABLE IF NOT EXISTS ' . t('media_chunks') . " (
        media_id VARCHAR(32) NOT NULL,
        seq INT UNSIGNED NOT NULL,
        data MEDIUMBLOB NOT NULL,
        PRIMARY KEY (media_id, seq)
    ) $options");
    // The screen settings, plus updatedAt (bumped on every change so the TV knows to reload), tvStatus (what the
    // TV last reported) and schemaVersion. Values are JSON.
    $pdo->exec('CREATE TABLE IF NOT EXISTS ' . t('settings') . " (
        name VARCHAR(40) NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
    ) $options");
    // Failed admin logins, to slow down password guessing.
    $pdo->exec('CREATE TABLE IF NOT EXISTS ' . t('logins') . " (
        ip VARCHAR(45) NOT NULL PRIMARY KEY,
        fails INT UNSIGNED NOT NULL,
        locked_until INT UNSIGNED NOT NULL
    ) $options");
    $pdo->prepare('REPLACE INTO ' . t('settings') . " (name, value) VALUES ('schemaVersion', ?)")->execute([SCHEMA_VERSION]);
}

function newId()
{
    return bin2hex(random_bytes(12));
}

function nowMs()
{
    return (int) round(microtime(true) * 1000);
}

// ---------- Validation ----------
function clip($value, $max)
{
    if (!is_string($value) || !preg_match('//u', $value)) return ''; // not text, or not valid UTF-8
    return preg_match('/^.{0,' . $max . '}/us', trim($value), $m) ? $m[0] : '';
}

function clampInt($value, $min, $max, $fallback)
{
    return is_numeric($value) ? (int) max($min, min($max, round((float) $value))) : $fallback;
}

function isoDate($value)
{
    return is_string($value) && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) && checkdate($m[2], $m[3], $m[1]) ? $value : '';
}

function color($value, $fallback)
{
    return is_string($value) && preg_match('/^#[0-9a-f]{6}$/i', $value) ? $value : $fallback;
}

// Whitelists and normalizes an ad's editable fields, on top of the ad's current values.
function sanitizeAd(array $input, array $existing = [])
{
    $m = array_merge($existing, $input);
    $get = fn($key) => $m[$key] ?? null;
    $title = clip($get('title'), 120);
    return [
        'type' => in_array($get('type'), ['image', 'video', 'text'], true) ? $m['type'] : 'text',
        'title' => $title !== '' ? $title : 'Untitled ad',
        'duration' => clampInt($get('duration'), 3, 600, 15),
        'playFullVideo' => (bool) $get('playFullVideo'),
        'videoLength' => clampInt($get('videoLength'), 0, 3600, 0), // seconds, measured by the admin page
        'muted' => $get('muted') === null ? true : (bool) $m['muted'],
        'fit' => $get('fit') === 'contain' ? 'contain' : 'cover',
        'background' => color($get('background'), '#000000'),
        'enabled' => $get('enabled') === null ? true : (bool) $m['enabled'],
        'startDate' => isoDate($get('startDate')),
        'endDate' => isoDate($get('endDate')),
        'playsPerLoop' => clampInt($get('playsPerLoop'), 1, 5, 1),
        'headline' => clip($get('headline'), 200),
        'body' => clip($get('body'), 600),
        'footer' => clip($get('footer'), 200),
        'textColor' => color($get('textColor'), '#ffffff'),
        'accentColor' => color($get('accentColor'), '#5fa82a'),
        'notes' => clip($get('notes'), 1000),
    ];
}

// Works out what the TV plays for a music link: the video and/or playlist id of a YouTube link (watch,
// youtu.be, embed, shorts, playlist), or any other web address as a radio stream. Returns null if it's neither.
function parseMusicLink($link)
{
    $text = clip($link, 500);
    $url = preg_match('~^https?://~i', $text) ? $text : "https://$text";
    $parts = filter_var($url, FILTER_VALIDATE_URL) ? parse_url($url) : false;
    if (!$parts || !isset($parts['host']) || strpos($parts['host'], '.') === false) return null;
    $host = preg_replace('/^(www|m|music)\./', '', strtolower($parts['host']));
    parse_str($parts['query'] ?? '', $query);
    $path = $parts['path'] ?? '';
    $videoIdOf = fn($v) => is_string($v) && preg_match('/^[\w-]{11}$/', $v) ? $v : null;
    if ($host === 'youtu.be') {
        $videoId = $videoIdOf(substr($path, 1));
    } elseif ($host === 'youtube.com' || $host === 'youtube-nocookie.com') {
        $videoId = $videoIdOf($query['v'] ?? null);
        if (!$videoId && preg_match('~^/(?:embed|shorts|live)/([^/]+)~', $path, $m)) $videoId = $videoIdOf($m[1]);
    } else {
        return ['stream' => $url];
    }
    $list = is_string($query['list'] ?? null) && preg_match('/^[\w-]{2,64}$/', $query['list']) ? $query['list'] : null;
    return $videoId || $list ? ['videoId' => $videoId, 'list' => $list] : null;
}

// ---------- Settings and status ----------
// Every row of the settings table, decoded. Read once per request, and again after a change ($forget).
function settingsRows($forget = false)
{
    static $rows = null;
    if ($forget) {
        $rows = null;
        return null;
    }
    if ($rows === null) {
        $rows = [];
        foreach (db()->query('SELECT name, value FROM ' . t('settings'))->fetchAll(PDO::FETCH_KEY_PAIR) as $name => $value) {
            $rows[$name] = json_decode($value, true);
        }
    }
    return $rows;
}

function saveRows(array $rows)
{
    $stmt = db()->prepare('REPLACE INTO ' . t('settings') . ' (name, value) VALUES (?, ?)');
    foreach ($rows as $name => $value) $stmt->execute([$name, json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
    settingsRows(true);
}

function settings()
{
    $rows = settingsRows();
    $settings = DEFAULT_SETTINGS;
    foreach ($settings as $name => $value) {
        if (isset($rows[$name]) && gettype($rows[$name]) === gettype($value)) $settings[$name] = $rows[$name];
    }
    return $settings;
}

// When the ads or settings last changed. The TV reloads its playlist when this moves.
function updatedAt()
{
    return settingsRows()['updatedAt'] ?? 0;
}

function markChanged()
{
    saveRows(['updatedAt' => nowMs()]);
}

function updateSettings(array $input)
{
    $current = settings();
    $has = fn($key) => array_key_exists($key, $input);
    $musicUrl = $current['musicUrl'];
    if ($has('musicUrl')) {
        $musicUrl = clip($input['musicUrl'], 500);
        if (!parseMusicLink($musicUrl)) throw new HttpError(400, 'That doesn’t look like a radio stream or YouTube link.');
    }
    saveRows([
        'transition' => in_array($input['transition'] ?? null, ['fade', 'slide', 'none'], true) ? $input['transition'] : $current['transition'],
        'idleTitle' => $has('idleTitle') ? clip($input['idleTitle'], 120) : $current['idleTitle'],
        'idleSubtitle' => $has('idleSubtitle') ? clip($input['idleSubtitle'], 200) : $current['idleSubtitle'],
        'musicEnabled' => $has('musicEnabled') ? (bool) $input['musicEnabled'] : $current['musicEnabled'],
        'musicUrl' => $musicUrl,
        'updatedAt' => nowMs(),
    ]);
    return settings();
}

function tvStatus()
{
    return settingsRows()['tvStatus'] ?? null;
}

function saveTvStatus(array $status)
{
    saveRows(['tvStatus' => $status]);
}

// ---------- Ads ----------
function mediaSrc($mediaId)
{
    return $mediaId ? 'api.php?action=media&id=' . $mediaId : '';
}

function rowToAd(array $r)
{
    return [
        'id' => (string) $r['id'],
        'type' => $r['type'],
        'title' => $r['title'],
        'src' => mediaSrc($r['media_id']),
        'fileSize' => $r['file_size'] === null ? 0 : (int) $r['file_size'],
        'duration' => (int) $r['duration'],
        'playFullVideo' => (bool) $r['play_full_video'],
        'videoLength' => (int) $r['video_length'],
        'muted' => (bool) $r['muted'],
        'fit' => $r['fit'],
        'background' => $r['background'],
        'enabled' => (bool) $r['enabled'],
        'startDate' => $r['start_date'] ?: '',
        'endDate' => $r['end_date'] ?: '',
        'playsPerLoop' => (int) $r['plays_per_loop'],
        'headline' => $r['headline'],
        'body' => $r['body'],
        'footer' => $r['footer'],
        'textColor' => $r['text_color'],
        'accentColor' => $r['accent_color'],
        'notes' => $r['notes'],
    ];
}

function adQuery($where = '')
{
    return 'SELECT a.*, m.size AS file_size FROM ' . t('ads') . ' a LEFT JOIN ' . t('media') . " m ON m.id = a.media_id $where";
}

function listAds()
{
    return array_map('rowToAd', db()->query(adQuery('ORDER BY a.position, a.created_at'))->fetchAll());
}

function findAdRow($id)
{
    $stmt = db()->prepare(adQuery('WHERE a.id = ?'));
    $stmt->execute([(string) $id]);
    return $stmt->fetch() ?: null;
}

function adColumns(array $ad)
{
    return [
        'type' => $ad['type'],
        'title' => $ad['title'],
        'duration' => $ad['duration'],
        'play_full_video' => (int) $ad['playFullVideo'],
        'video_length' => $ad['videoLength'],
        'muted' => (int) $ad['muted'],
        'fit' => $ad['fit'],
        'background' => $ad['background'],
        'enabled' => (int) $ad['enabled'],
        'start_date' => $ad['startDate'] ?: null,
        'end_date' => $ad['endDate'] ?: null,
        'plays_per_loop' => $ad['playsPerLoop'],
        'headline' => $ad['headline'],
        'body' => $ad['body'],
        'footer' => $ad['footer'],
        'text_color' => $ad['textColor'],
        'accent_color' => $ad['accentColor'],
        'notes' => $ad['notes'],
    ];
}

function createAd(array $fields, $mediaId)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        if ($mediaId) $fields['type'] = claimMedia($mediaId);
        $ad = sanitizeAd($fields);
        if ($ad['type'] !== 'text' && !$mediaId) throw new HttpError(400, 'Choose an image or video file to upload.');
        $id = newId();
        $columns = adColumns($ad) + [
            'id' => $id,
            'media_id' => $ad['type'] === 'text' ? null : $mediaId,
            'position' => (int) $pdo->query('SELECT COALESCE(MAX(position), -1) + 1 FROM ' . t('ads'))->fetchColumn(),
        ];
        $pdo->prepare('INSERT INTO ' . t('ads') . ' (' . implode(', ', array_keys($columns)) . ') VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ')')
            ->execute(array_values($columns));
        markChanged();
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
    return rowToAd(findAdRow($id));
}

// Saves the given fields over an ad's current ones, so the admin panel can send just the ones that changed.
function updateAd($id, array $fields, $mediaId)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $row = findAdRow($id);
        if (!$row) throw new HttpError(404, 'Ad not found.');
        $existing = rowToAd($row);
        if ($mediaId) {
            $fields['type'] = claimMedia($mediaId);
        } elseif (isset($fields['type']) && $fields['type'] !== 'text' && $fields['type'] !== $existing['type']) {
            throw new HttpError(400, $fields['type'] === 'video' ? 'Upload a video to switch this ad to video.' : 'Upload an image to switch this ad to an image.');
        }
        $ad = sanitizeAd($fields, $existing);
        // A text slide has no file; switching to one deletes the old image or video.
        $newMediaId = $ad['type'] === 'text' ? null : ($mediaId ?: $row['media_id']);
        $columns = adColumns($ad) + ['media_id' => $newMediaId];
        $sets = implode(', ', array_map(fn($column) => "$column = ?", array_keys($columns)));
        $pdo->prepare('UPDATE ' . t('ads') . " SET $sets WHERE id = ?")->execute(array_merge(array_values($columns), [$row['id']]));
        if ($row['media_id'] && $row['media_id'] !== $newMediaId) deleteMedia($row['media_id']);
        markChanged();
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
    return rowToAd(findAdRow($id));
}

function deleteAd($id)
{
    $pdo = db();
    $row = findAdRow($id);
    if (!$row) throw new HttpError(404, 'Ad not found.');
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM ' . t('ads') . ' WHERE id = ?')->execute([$row['id']]);
    if ($row['media_id']) deleteMedia($row['media_id']);
    markChanged();
    $pdo->commit();
}

// Puts the ads in the given order. Any ad not mentioned keeps its place at the end rather than being dropped.
function reorderAds(array $ids)
{
    $pdo = db();
    $current = $pdo->query('SELECT id FROM ' . t('ads') . ' ORDER BY position, created_at')->fetchAll(PDO::FETCH_COLUMN);
    $ordered = array_values(array_intersect(array_unique($ids), $current));
    $order = array_merge($ordered, array_values(array_diff($current, $ordered)));
    $pdo->beginTransaction();
    $stmt = $pdo->prepare('UPDATE ' . t('ads') . ' SET position = ? WHERE id = ?');
    foreach ($order as $position => $id) $stmt->execute([$position, $id]);
    markChanged();
    $pdo->commit();
    return listAds();
}

// ---------- Media ----------
function maxUploadBytes()
{
    return (int) (max(1, (float) config('max_upload_mb')) * 1048576);
}

function startUpload($size, $mime)
{
    if (!is_string($mime) || !isset(MEDIA_TYPES[$mime])) {
        throw new HttpError(400, 'That file type can’t be uploaded. Use a JPG, PNG, WebP or GIF image, or an MP4, WebM or MOV video.');
    }
    $size = is_numeric($size) ? (int) $size : 0;
    if ($size <= 0) throw new HttpError(400, 'That file is empty.');
    if ($size > maxUploadBytes()) {
        throw new HttpError(413, 'That file is too large (the limit is ' . config('max_upload_mb') . ' MB, set by max_upload_mb in config.php).');
    }
    // Clear out uploads that were abandoned partway (a closed tab, a dropped connection).
    $pdo = db();
    $stale = $pdo->query('SELECT id FROM ' . t('media') . ' WHERE ready = 0 AND created_at < NOW() - INTERVAL 1 DAY')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($stale as $staleId) deleteMedia($staleId);

    $id = newId();
    $pdo->prepare('INSERT INTO ' . t('media') . ' (id, mime, size, chunk_size) VALUES (?, ?, ?, ?)')->execute([$id, $mime, $size, CHUNK_SIZE]);
    return ['id' => $id, 'chunkSize' => CHUNK_SIZE];
}

function mediaRow($id)
{
    if (!is_string($id) || !preg_match('/^[0-9a-f]{24}$/', $id)) return null;
    $stmt = db()->prepare('SELECT id, mime, size, chunk_size, ready FROM ' . t('media') . ' WHERE id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

function chunkCount(array $media)
{
    return (int) ceil($media['size'] / $media['chunk_size']);
}

// Stores one piece of an upload. Sending the same piece again (a retry) replaces it.
function saveChunk($id, $seq, $data)
{
    $media = mediaRow($id);
    if (!$media || $media['ready']) throw new HttpError(404, 'This upload has expired. Try again.');
    $count = chunkCount($media);
    $seq = is_numeric($seq) ? (int) $seq : -1;
    if ($seq < 0 || $seq >= $count) throw new HttpError(400, 'Invalid upload.');
    $expected = $seq < $count - 1 ? (int) $media['chunk_size'] : (int) $media['size'] - ($count - 1) * (int) $media['chunk_size'];
    if (strlen($data) !== $expected) throw new HttpError(400, 'Part of the file got lost on the way. Try again.');
    $stmt = db()->prepare('REPLACE INTO ' . t('media_chunks') . ' (media_id, seq, data) VALUES (?, ?, ?)');
    $stmt->bindValue(1, $media['id']);
    $stmt->bindValue(2, $seq, PDO::PARAM_INT);
    $stmt->bindValue(3, $data, PDO::PARAM_LOB);
    $stmt->execute();
}

// Checks every piece of an upload arrived and marks it as in use. Returns the kind of ad it makes.
function claimMedia($id)
{
    $media = mediaRow($id);
    if (!$media || $media['ready']) throw new HttpError(400, 'The upload didn’t finish. Try again.');
    $stmt = db()->prepare('SELECT COUNT(*) FROM ' . t('media_chunks') . ' WHERE media_id = ?');
    $stmt->execute([$media['id']]);
    if ((int) $stmt->fetchColumn() !== chunkCount($media)) throw new HttpError(400, 'The upload didn’t finish. Try again.');
    db()->prepare('UPDATE ' . t('media') . ' SET ready = 1 WHERE id = ?')->execute([$media['id']]);
    return MEDIA_TYPES[$media['mime']];
}

function deleteMedia($id)
{
    db()->prepare('DELETE FROM ' . t('media_chunks') . ' WHERE media_id = ?')->execute([$id]);
    db()->prepare('DELETE FROM ' . t('media') . ' WHERE id = ?')->execute([$id]);
}

function readChunk($id, $seq)
{
    $stmt = db()->prepare('SELECT data FROM ' . t('media_chunks') . ' WHERE media_id = ? AND seq = ?');
    $stmt->execute([$id, $seq]);
    $data = $stmt->fetchColumn();
    $stmt->closeCursor();
    return $data === false ? null : $data;
}

// Bytes of images and videos stored in the database.
function storageUsed()
{
    return (int) db()->query('SELECT COALESCE(SUM(size), 0) FROM ' . t('media') . ' WHERE ready = 1')->fetchColumn();
}
