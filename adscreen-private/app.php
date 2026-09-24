<?php
// Handles every request to public_html/api.php: the TV's playlist and check-ins, the admin panel, and the ads'
// images and videos. api.php?action=... picks what to do.

require __DIR__ . '/store.php';

ini_set('display_errors', '0'); // a PHP warning in the middle of a reply would break it; they go to the error log

const TOKEN_HEADER = 'HTTP_X_ADMIN_TOKEN';
const MUSIC_STATES = ['off', 'loading', 'playing', 'muted', 'blocked', 'error'];

function respond($data, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

// The JSON the admin panel and the TV send.
function body()
{
    static $body = null;
    if ($body === null) {
        $body = json_decode(file_get_contents('php://input'), true);
        if (!is_array($body)) $body = [];
    }
    return $body;
}

function requirePost()
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') throw new HttpError(405, 'Use POST.');
}

// ---------- Auth ----------
// A single shared password (admin_password in config.php). The token is derived from it, so changing the
// password logs every browser out.
function adminToken()
{
    $password = (string) config('admin_password');
    return $password === '' ? null : hash_hmac('sha256', 'gym-ad-screen-admin', $password);
}

function requireAdmin()
{
    $expected = adminToken();
    $given = (string) ($_SERVER[TOKEN_HEADER] ?? '');
    if (!$expected || !hash_equals($expected, $given)) throw new HttpError(401, 'Not logged in.');
}

function login()
{
    requirePost();
    $expected = adminToken();
    if (!$expected) throw new HttpError(503, 'admin_password isn’t set. Add it to config.php in the adscreen-private folder.');

    $ip = substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
    $stmt = db()->prepare('SELECT fails, locked_until FROM ' . t('logins') . ' WHERE ip = ?');
    $stmt->execute([$ip]);
    $entry = $stmt->fetch();
    if ($entry && $entry['locked_until'] > time()) throw new HttpError(429, 'Too many attempts. Try again in a minute.');

    $password = body()['password'] ?? '';
    if (!is_string($password) || !hash_equals((string) config('admin_password'), $password)) {
        $fails = ($entry ? (int) $entry['fails'] : 0) + 1;
        db()->prepare('REPLACE INTO ' . t('logins') . ' (ip, fails, locked_until) VALUES (?, ?, ?)')
            ->execute([$ip, $fails, $fails >= 5 ? time() + 60 : 0]);
        throw new HttpError(401, 'Wrong password.');
    }
    db()->prepare('DELETE FROM ' . t('logins') . ' WHERE ip = ?')->execute([$ip]);
    respond(['token' => $expected]);
}

// ---------- TV ----------
function playlist()
{
    $settings = settings();
    // Date windows are checked on the TV itself, in the gym's local timezone.
    $ads = [];
    foreach (listAds() as $ad) {
        if (!$ad['enabled']) continue;
        unset($ad['notes'], $ad['fileSize']); // admin-only
        $ads[] = $ad;
    }
    respond([
        'ads' => $ads,
        'settings' => $settings,
        'music' => $settings['musicEnabled'] ? parseMusicLink($settings['musicUrl']) : null,
        'updatedAt' => updatedAt(),
    ]);
}

function heartbeat()
{
    requirePost();
    $b = body();
    $music = is_array($b['music'] ?? null) ? $b['music'] : [];
    $text = fn($v, $max) => is_string($v) ? clip($v, $max) : null;
    saveTvStatus([
        'adId' => $text($b['adId'] ?? null, 32),
        'title' => $text($b['title'] ?? null, 120),
        'music' => in_array($music['state'] ?? null, MUSIC_STATES, true)
            ? [
                'state' => $music['state'],
                'title' => $text($music['title'] ?? null, 200),
                'error' => is_int($music['error'] ?? null) || is_string($music['error'] ?? null) ? clip((string) $music['error'], 20) : null,
            ]
            : null,
        'seenAt' => nowMs(),
    ]);
    respond(['ok' => true]);
}

// Sends an image or video from the database. Supports byte ranges, which TVs and Safari need to play video.
function serveMedia()
{
    $media = mediaRow($_GET['id'] ?? null);
    if (!$media || !$media['ready']) {
        http_response_code(404);
        header('Cache-Control: no-store');
        exit;
    }
    $size = (int) $media['size'];
    $etag = '"' . $media['id'] . '"';
    // A replaced file gets a new id, so a file never changes and the TV can keep it cached.
    header('Cache-Control: public, max-age=31536000, immutable');
    header('ETag: ' . $etag);
    header('Accept-Ranges: bytes');
    header('Content-Type: ' . $media['mime']);
    header('X-Content-Type-Options: nosniff');
    if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        exit;
    }

    $start = 0;
    $end = $size - 1;
    // Only a single range is supported; anything else gets the whole file, which is allowed.
    if (preg_match('/^bytes=(\d*)-(\d*)$/', trim($_SERVER['HTTP_RANGE'] ?? ''), $range) && ($range[1] !== '' || $range[2] !== '')) {
        if ($range[1] === '') {
            $start = $size - min((int) $range[2], $size); // the last N bytes
        } else {
            $start = (int) $range[1];
            if ($range[2] !== '') $end = min((int) $range[2], $size - 1);
        }
        if ($start > $end) {
            http_response_code(416);
            header("Content-Range: bytes */$size");
            exit;
        }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') exit;

    @set_time_limit(0);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level()) ob_end_clean();
    $chunkSize = (int) $media['chunk_size'];
    $first = intdiv($start, $chunkSize);
    $last = intdiv($end, $chunkSize);
    for ($seq = $first; $seq <= $last; $seq++) {
        $data = readChunk($media['id'], $seq);
        if ($data === null) break;
        $from = $seq === $first ? $start - $seq * $chunkSize : 0;
        $to = $seq === $last ? $end - $seq * $chunkSize : $chunkSize - 1;
        echo substr($data, $from, $to - $from + 1);
        flush();
        if (connection_aborted()) break;
    }
    exit;
}

// ---------- Admin ----------
function adminState()
{
    respond([
        'ads' => listAds(),
        'settings' => settings(),
        'updatedAt' => updatedAt(),
        'display' => tvStatus(),
        'storage' => ['used' => storageUsed(), 'maxUpload' => maxUploadBytes()],
    ]);
}

function uploadChunk()
{
    $file = $_FILES['chunk'] ?? null;
    if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
        $tooBig = $file && in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
        throw new HttpError(400, $tooBig
            ? 'The server’s PHP upload limit is below 1 MB. Raise upload_max_filesize in cPanel → MultiPHP INI Editor.'
            : 'Part of the file didn’t arrive. Try again.');
    }
    saveChunk($_POST['id'] ?? null, $_POST['seq'] ?? null, file_get_contents($file['tmp_name']));
    respond(['ok' => true]);
}

function saveSpot()
{
    $b = body();
    $fields = is_array($b['fields'] ?? null) ? $b['fields'] : [];
    $mediaId = is_string($b['mediaId'] ?? null) && $b['mediaId'] !== '' ? $b['mediaId'] : null;
    $id = $b['id'] ?? null;
    respond(is_string($id) && $id !== '' ? updateAd($id, $fields, $mediaId) : createAd($fields, $mediaId));
}

// ---------- Routing ----------
// Every handler ends the request (respond() exits), so the cases don't need a break.
try {
    $action = $_GET['action'] ?? '';
    switch ($action) {
        case 'media':
            serveMedia();
        case 'playlist':
            playlist();
        case 'heartbeat':
            heartbeat();
        case 'login':
            login();
    }

    requireAdmin();
    if ($action === 'state') adminState();
    requirePost();
    switch ($action) {
        case 'upload-start':
            respond(startUpload(body()['size'] ?? null, body()['type'] ?? null));
        case 'upload-chunk':
            uploadChunk();
        case 'save-spot':
            saveSpot();
        case 'delete-spot':
            deleteAd((string) (body()['id'] ?? ''));
            respond(['ok' => true]);
        case 'order':
            $ids = is_array(body()['ids'] ?? null) ? array_filter(body()['ids'], 'is_string') : [];
            respond(reorderAds($ids));
        case 'settings':
            respond(updateSettings(body()));
    }
    throw new HttpError(404, 'Unknown action.');
} catch (HttpError $e) {
    respond(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('Ad screen: ' . $e);
    respond(['error' => 'Something went wrong on the server. Try again.'], 500);
}
