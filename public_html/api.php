<?php
// Every request from the TV screen and the admin panel comes through here. The code that answers them, and
// config.php with the passwords, is in the adscreen-private folder. Upload that folder next to public_html (not
// inside it) so nobody can download it. This looks for it in each folder above this one.
for ($dir = __DIR__; ; $dir = dirname($dir)) {
    if (@is_file("$dir/adscreen-private/app.php")) {
        require "$dir/adscreen-private/app.php";
        exit;
    }
    if (dirname($dir) === $dir) break;
}
http_response_code(500);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['error' => 'The adscreen-private folder is missing. Upload it next to public_html (not inside it).']);
