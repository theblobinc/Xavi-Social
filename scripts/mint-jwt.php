<?php

declare(strict_types=1);

// Minimal JWT (HS256) mint helper for CLI/MCP testing.
//
// This mirrors the package's /xavi_social/api/jwt encoder + API bearer decoders.
// It is intended for local/dev automation where you already control the secret.
//
// Usage:
//   XAVI_SOCIAL_JWT_SECRET=... php mint-jwt.php --sub=1 --name=admin --iss=http://localhost:6478
// Optional:
//   --exp-seconds=3600
//   --secret=... (overrides env; less safe)
//
// Output:
//   prints the JWT token (only) to stdout.

function usageAndExit(int $code): void {
    fwrite(STDERR, "Usage: php mint-jwt.php [--sub=<userId>] [--name=<userName>] [--iss=<issuer>] [--exp-seconds=<seconds>] [--secret=<secret>]\n");
    fwrite(STDERR, "Example: XAVI_SOCIAL_JWT_SECRET=... php mint-jwt.php --sub=1 --iss=http://localhost:6478\n");
    exit($code);
}

$opts = getopt('', ['sub::', 'name::', 'iss::', 'exp-seconds::', 'secret::', 'help::']);
if (isset($opts['help'])) {
    usageAndExit(0);
}

$sub = isset($opts['sub']) ? (int) $opts['sub'] : 0;
$name = isset($opts['name']) ? (string) $opts['name'] : '';
$iss = isset($opts['iss']) ? (string) $opts['iss'] : '';
$expSeconds = isset($opts['exp-seconds']) ? (int) $opts['exp-seconds'] : 3600;
if ($expSeconds <= 0) {
    $expSeconds = 3600;
}

$secret = '';
if (isset($opts['secret']) && $opts['secret'] !== false) {
    $secret = (string) $opts['secret'];
}
if ($secret === '') {
    $env = getenv('XAVI_SOCIAL_JWT_SECRET');
    $secret = $env === false ? '' : (string) $env;
}

if ($secret === '') {
    fwrite(STDERR, "ERROR: Missing secret. Set XAVI_SOCIAL_JWT_SECRET (preferred) or pass --secret.\n");
    exit(1);
}

if ($sub <= 0) {
    fwrite(STDERR, "ERROR: Missing/invalid --sub (Concrete user ID). Example: --sub=1\n");
    exit(1);
}

$now = time();
$payload = [
    'sub' => $sub,
    'iat' => $now,
    'exp' => $now + $expSeconds,
];
if ($iss !== '') {
    $payload['iss'] = $iss;
}
if ($name !== '') {
    $payload['name'] = $name;
}

$header = ['typ' => 'JWT', 'alg' => 'HS256'];

$header64 = rtrim(strtr(base64_encode((string) json_encode($header, JSON_UNESCAPED_SLASHES)), '+/', '-_'), '=');
$payload64 = rtrim(strtr(base64_encode((string) json_encode($payload, JSON_UNESCAPED_SLASHES)), '+/', '-_'), '=');
$toSign = $header64 . '.' . $payload64;
$sig = hash_hmac('sha256', $toSign, $secret, true);
$sig64 = rtrim(strtr(base64_encode($sig), '+/', '-_'), '=');

fwrite(STDOUT, $toSign . '.' . $sig64 . "\n");
