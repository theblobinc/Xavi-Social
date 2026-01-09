<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api;

use Concrete\Package\XaviSocial\Crypto\TokenCipher;
use Concrete\Core\Http\Request;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Support\Facade\Config;
use Concrete\Core\User\User;
use Concrete\Package\XaviSocial\Atproto\LocalPdsProvisioner;
use GuzzleHttp\Client;
use Symfony\Component\HttpFoundation\JsonResponse;

final class Post extends PageController
{
    public function view(): void
    {
        if (strtoupper((string) $this->request->getMethod()) !== 'POST') {
            $this->sendJson(['error' => 'method_not_allowed'], 405);
        }

        [$authMethod, $user] = $this->authenticate();
        if ($user === null || !$user->isRegistered()) {
            $this->sendJson([
                'error' => 'not_authenticated',
                'message' => 'Concrete login (cookie) or Bearer JWT required to post.',
            ], 401);
        }

        $raw = (string) $this->request->getContent();
        // In some Concrete/Symfony setups, the request content can appear empty if
        // php://input has been consumed earlier in the lifecycle. Fall back to
        // reading it directly so we can still accept JSON bodies.
        if ($raw === '') {
            $fallback = @file_get_contents('php://input');
            if ($fallback !== false && $fallback !== '') {
                $raw = (string) $fallback;
            }
        }
        $rawTrim = trim($raw);

        $json = null;
        if ($rawTrim !== '') {
            $json = json_decode($raw, true);
        }

        $text = '';
        if (is_string($json)) {
            // Allows JSON bodies like "hello world".
            $text = $json;
        } elseif (is_array($json)) {
            // Allow a few common shapes.
            $payload = $json;
            if (isset($payload['record']) && is_array($payload['record'])) {
                $payload = $payload['record'];
            } elseif (isset($payload['post']) && is_array($payload['post'])) {
                $payload = $payload['post'];
            } elseif (isset($payload['data']) && is_array($payload['data'])) {
                $payload = $payload['data'];
            }

            $text = (string) (
                $payload['text']
                ?? $payload['message']
                ?? $payload['content']
                ?? $payload['body']
                ?? $payload['value']
                ?? ''
            );
        } else {
            // Be tolerant of non-JSON payloads (e.g. form-encoded or text/plain).
            // This lets different frontends call the endpoint without having to match a strict schema.
            $text = (string) ($this->request->request->get('text') ?? '');
            if (trim($text) === '') {
                $text = (string) ($this->request->request->get('message') ?? '');
            }
            if (trim($text) === '') {
                $text = (string) ($this->request->request->get('content') ?? '');
            }
            if (trim($text) === '') {
                $text = (string) ($this->request->query->get('text') ?? '');
            }
            if (trim($text) === '' && $rawTrim !== '') {
                // If the client sent plain text, treat the whole body as the post text.
                $text = $rawTrim;
            }
        }

        $text = trim($text);
        if ($text === '') {
            $jsonKeys = [];
            if (is_array($json)) {
                $jsonKeys = array_slice(array_keys($json), 0, 25);
            }

            $rawPreview = '';
            if ($rawTrim !== '') {
                $rawPreview = mb_substr($rawTrim, 0, 200);
            }
            $formKeys = [];
            try {
                $formKeys = array_slice(array_keys((array) $this->request->request->all()), 0, 25);
            } catch (\Throwable $e) {
                $formKeys = [];
            }
            $queryKeys = [];
            try {
                $queryKeys = array_slice(array_keys((array) $this->request->query->all()), 0, 25);
            } catch (\Throwable $e) {
                $queryKeys = [];
            }

            $this->sendJson([
                'error' => 'bad_request',
                'message' => 'Missing text. Send JSON {"text": "..."}, JSON "...", a form field named "text", or text/plain body.',
                'diagnostic' => [
                    'contentType' => (string) ($this->request->headers->get('Content-Type') ?? ''),
                    'rawLength' => strlen($raw),
                    'rawPreview' => $rawPreview,
                    'jsonType' => is_array($json) ? 'array' : (is_string($json) ? 'string' : ($json === null ? 'null' : gettype($json))),
                    'jsonKeys' => $jsonKeys,
                    'formKeys' => $formKeys,
                    'queryKeys' => $queryKeys,
                ],
            ], 400);
        }
        if (mb_strlen($text) > 3000) {
            $this->sendJson([
                'error' => 'bad_request',
                'message' => 'Text too long.',
            ], 400);
        }

        $userId = (int) $user->getUserID();

        // Prefer posting as the user's local PDS account.
        $localAccount = $this->getLocalPdsAccountRow($userId);
        if (!is_array($localAccount)) {
            try {
                $provisioner = new LocalPdsProvisioner($this->app);
                $res = $provisioner->ensureLocalAccountForUserId($userId);
                $localAccount = isset($res['account']) && is_array($res['account']) ? $res['account'] : null;
            } catch (\Throwable $e) {
                if (stripos($e->getMessage(), 'invite') !== false) {
                    $this->sendJson([
                        'error' => 'invite_required',
                        'message' => 'PDS invite code required. Configure XAVI_SOCIAL_ATPROTO_INVITE_CODE (or xavi_social.atproto.invite_code).',
                    ], 409);
                }

                $localAccount = null;
            }
        }

        if (is_array($localAccount)) {
            $did = trim((string) ($localAccount['did'] ?? ''));
            $pdsUrl = trim((string) ($localAccount['pdsUrl'] ?? ''));
            $accountId = (int) ($localAccount['id'] ?? 0);

            if ($pdsUrl === '') {
                $pdsUrl = $this->getDefaultPdsOrigin();
            }

            $pdsHttp = $this->normalizeOriginForServerCalls($pdsUrl);

            $cipher = new TokenCipher($this->app);
            $accessJwt = '';
            $refreshJwt = '';

            try {
                $accessJwt = (string) $cipher->decrypt((string) ($localAccount['accessToken'] ?? ''));
                $refreshJwt = (string) $cipher->decrypt((string) ($localAccount['refreshToken'] ?? ''));
            } catch (\Throwable $e) {
                $accessJwt = '';
                $refreshJwt = '';
            }

            if ($did !== '' && $accessJwt !== '') {
                $record = [
                    '$type' => 'app.bsky.feed.post',
                    'text' => $text,
                    'createdAt' => date(DATE_ATOM),
                ];

                $out = $this->createRecordWithJwt($pdsHttp, $accessJwt, $did, $record);

                // If access token is stale, try refreshSession once.
                if (($out['status'] ?? 0) === 401 || ($out['status'] ?? 0) === 403) {
                    if ($refreshJwt !== '' && $accountId > 0) {
                        try {
                            [$newAccess, $newRefresh] = $this->refreshLocalSession($pdsHttp, $refreshJwt);
                            $this->storeLocalTokens($accountId, $newAccess, $newRefresh);

                            $out = $this->createRecordWithJwt($pdsHttp, $newAccess, $did, $record);
                        } catch (\Throwable $e) {
                            // Fall through to error.
                        }
                    }
                }

                if (($out['ok'] ?? false) === true) {
                    $this->sendJson([
                        'ok' => true,
                        'source' => 'atproto',
                        'mode' => 'pds_user',
                        'authMethod' => $authMethod,
                        'userId' => $userId,
                        'userName' => (string) $user->getUserName(),
                        'pdsAccount' => [
                            'did' => $did,
                            'handle' => (string) ($localAccount['handle'] ?? ''),
                        ],
                        'uri' => (string) ($out['uri'] ?? ''),
                        'cid' => (string) ($out['cid'] ?? ''),
                    ]);
                }

                $status = (int) ($out['status'] ?? 502);
                if ($status < 400 || $status > 599) {
                    $status = 502;
                }

                $payload = [
                    'error' => 'local_account_post_failed',
                    'message' => 'Failed to post as local PDS account.',
                    'status' => $status,
                    'upstream' => [
                        'origin' => $pdsHttp,
                        'status' => $status,
                        'error' => (string) ($out['error'] ?? ''),
                        'message' => (string) ($out['message'] ?? ''),
                    ],
                ];
                if (isset($out['raw']) && is_string($out['raw']) && $out['raw'] !== '') {
                    $payload['upstream']['raw'] = $out['raw'];
                }

                $this->sendJson($payload, $status);
            }
        }

        $xrpcHost = $this->getAtprotoXrpcHost();
        $identifier = $this->getAtprotoIdentifier();
        $password = $this->getAtprotoPassword();

        if ($xrpcHost === '' || $identifier === '' || $password === '') {
            $this->sendJson([
                'error' => 'atproto_not_configured',
                'message' => 'Configure ATProto (XRPC host + credentials) before posting.',
                'authMethod' => $authMethod,
                'userId' => (int) $user->getUserID(),
                'userName' => (string) $user->getUserName(),
            ], 501);
        }

        [$accessJwt, $did] = $this->createSession($xrpcHost, $identifier, $password);

        $record = [
            '$type' => 'app.bsky.feed.post',
            'text' => $text,
            'createdAt' => date(DATE_ATOM),
        ];

        $client = $this->makeHttpClient();
        try {
            $resp = $client->post($xrpcHost . '/xrpc/com.atproto.repo.createRecord', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'body' => (string) json_encode([
                    'repo' => $did,
                    'collection' => 'app.bsky.feed.post',
                    'record' => $record,
                ], JSON_UNESCAPED_SLASHES),
            ]);
        } catch (\Throwable $e) {
            $this->sendJson([
                'error' => 'upstream_unreachable',
                'message' => 'Failed to connect to configured XRPC host.',
            ], 502);
        }

        $status = $resp->getStatusCode();
        $body = (string) $resp->getBody();
        $out = json_decode($body, true);

        if ($status < 200 || $status >= 300 || !is_array($out)) {
            $this->sendJson([
                'error' => 'upstream_error',
                'status' => $status,
                'message' => 'Failed to create record on configured XRPC host.',
            ], 502);
        }

        $this->sendJson([
            'ok' => true,
            'authMethod' => $authMethod,
            'userId' => $userId,
            'userName' => (string) $user->getUserName(),
            'uri' => (string) ($out['uri'] ?? ''),
            'cid' => (string) ($out['cid'] ?? ''),
        ]);
    }

    /**
     * @return array<string,mixed>|null
     */
    private function getLocalPdsAccountRow(int $userId): ?array
    {
        try {
            $db = $this->app->make('database')->connection();
        } catch (\Throwable $e) {
            return null;
        }

        try {
            $row = $db->fetchAssociative(
                "SELECT * FROM XaviSocialAtprotoAccounts\n" .
                "WHERE userId = ? AND revoked = 0\n" .
                "  AND (issuer IS NULL OR issuer = '')\n" .
                "ORDER BY id DESC\n" .
                "LIMIT 1",
                [$userId]
            );

            return is_array($row) ? $row : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function getDefaultPdsOrigin(): string
    {
        $req = Request::getInstance();
        $reqOrigin = rtrim($req->getSchemeAndHttpHost(), '/');
        if ($reqOrigin !== '' && $reqOrigin !== 'http://localhost' && $reqOrigin !== 'https://localhost') {
            return $reqOrigin;
        }

        $origin = (string) Config::get('site.sites.default.seo.canonical_url');
        if ($origin !== '') {
            return rtrim($origin, '/');
        }

        return $reqOrigin;
    }

    private function normalizeOriginForServerCalls(string $publicOrigin): string
    {
        // In this repo, PHP often runs inside Docker and nginx reverse-proxies the local PDS at /xrpc.
        // Using the public https origin from inside the container can fail (missing CA certs) and is
        // unnecessary; prefer the internal nginx service for server-to-server calls.
        if ($this->isDockerRuntime()) {
            $override = getenv('XAVI_SOCIAL_INTERNAL_HTTP_ORIGIN');
            if ($override !== false && trim((string) $override) !== '') {
                return rtrim(trim((string) $override), '/');
            }

            // NOTE: Do not use http://nginx here; this repo uses an external shared Docker network.
            return 'http://princegeorge-app-nginx';
        }

        $override = getenv('XAVI_SOCIAL_INTERNAL_HTTP_ORIGIN');
        if ($override !== false && trim((string) $override) !== '') {
            return rtrim(trim((string) $override), '/');
        }

        $host = (string) parse_url($publicOrigin, PHP_URL_HOST);
        $host = strtolower(trim($host));

        if ($host === '' || $host === 'localhost' || $host === '127.0.0.1' || $host === '0.0.0.0') {
            return 'http://princegeorge-app-nginx';
        }

        return rtrim($publicOrigin, '/');
    }

    private function isDockerRuntime(): bool
    {
        if (is_file('/.dockerenv')) {
            return true;
        }

        return (string) getenv('DB_HOST') === 'mariadb';
    }

    /**
     * @return array{ok: bool, status: int, uri?: string, cid?: string, error?: string, message?: string, raw?: string}
     */
    private function createRecordWithJwt(string $origin, string $accessJwt, string $did, array $record): array
    {
        $client = $this->makeHttpClient();

        try {
            $resp = $client->post(rtrim($origin, '/') . '/xrpc/com.atproto.repo.createRecord', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'body' => (string) json_encode([
                    'repo' => $did,
                    'collection' => 'app.bsky.feed.post',
                    'record' => $record,
                ], JSON_UNESCAPED_SLASHES),
            ]);
        } catch (\Throwable $e) {
            return [
                'ok' => false,
                'status' => 502,
                'error' => 'upstream_unreachable',
                'message' => 'Failed to connect to local PDS XRPC.',
            ];
        }

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            $err = is_array($json) ? trim((string) ($json['error'] ?? '')) : '';
            $msg = is_array($json) ? trim((string) ($json['message'] ?? '')) : '';
            $snippet = trim(substr($raw, 0, 2000));
            if ($snippet === '') {
                $snippet = '';
            }

            // PDS sometimes reports expired access tokens as HTTP 400 with error=ExpiredToken.
            // Normalize this to 401 so callers can refreshSession and retry.
            $normalizedStatus = $status;
            if (
                $status === 400 &&
                (
                    ($err !== '' && stripos($err, 'ExpiredToken') !== false) ||
                    ($msg !== '' && stripos($msg, 'expired') !== false)
                )
            ) {
                $normalizedStatus = 401;
            }

            return [
                'ok' => false,
                'status' => $normalizedStatus,
                'error' => $err !== '' ? $err : 'upstream_error',
                'message' => $msg !== '' ? $msg : ('PDS createRecord failed (HTTP ' . $status . ')'),
                'raw' => $snippet,
            ];
        }

        return [
            'ok' => true,
            'status' => $status,
            'uri' => (string) ($json['uri'] ?? ''),
            'cid' => (string) ($json['cid'] ?? ''),
        ];
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function refreshLocalSession(string $origin, string $refreshJwt): array
    {
        $client = $this->makeHttpClient();
        $resp = $client->post(rtrim($origin, '/') . '/xrpc/com.atproto.server.refreshSession', [
            'headers' => [
                'Accept' => 'application/json',
                'Authorization' => 'Bearer ' . $refreshJwt,
            ],
        ]);

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            throw new \RuntimeException('refreshSession failed');
        }

        $access = trim((string) ($json['accessJwt'] ?? ''));
        $refresh = trim((string) ($json['refreshJwt'] ?? ''));

        if ($access === '' || $refresh === '') {
            throw new \RuntimeException('refreshSession response missing tokens');
        }

        return [$access, $refresh];
    }

    private function storeLocalTokens(int $accountId, string $accessJwt, string $refreshJwt): void
    {
        if ($accountId <= 0) {
            return;
        }

        try {
            $db = $this->app->make('database')->connection();
        } catch (\Throwable $e) {
            return;
        }

        $cipher = new TokenCipher($this->app);

        try {
            $db->update('XaviSocialAtprotoAccounts', [
                'accessToken' => (string) $cipher->encrypt($accessJwt),
                'refreshToken' => (string) $cipher->encrypt($refreshJwt),
                'updatedAt' => time(),
            ], ['id' => $accountId]);
        } catch (\Throwable $e) {
            return;
        }
    }

    /**
     * @return array{0: 'bearer'|'cookie'|null, 1: User|null}
     */
    private function authenticate(): array
    {
        $authHeader = (string) $this->request->headers->get('Authorization', '');
        if (stripos($authHeader, 'Bearer ') === 0) {
            $token = trim(substr($authHeader, 7));
            $user = $this->authenticateBearer($token);
            return ['bearer', $user];
        }

        $cookieUser = $this->app->make(User::class);
        if ($cookieUser->isRegistered()) {
            return ['cookie', $cookieUser];
        }

        return [null, null];
    }

    private function authenticateBearer(string $token): ?User
    {
        $secret = $this->getJwtSecret();
        if ($secret === '') {
            return null;
        }

        try {
            $payload = $this->jwtDecodeHs256($token, $secret);
        } catch (\Throwable $e) {
            return null;
        }

        $userId = (int) ($payload['sub'] ?? 0);
        if ($userId <= 0) {
            return null;
        }

        return User::getByUserID($userId);
    }

    private function getJwtSecret(): string
    {
        $secret = (string) Config::get('xavi_social.jwt_secret');
        if ($secret !== '') {
            return $secret;
        }

        $env = getenv('XAVI_SOCIAL_JWT_SECRET');
        return $env === false ? '' : (string) $env;
    }

    /**
     * @return array<string,mixed>
     */
    private function jwtDecodeHs256(string $jwt, string $secret): array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            throw new \RuntimeException('Invalid JWT');
        }

        [$header64, $payload64, $sig64] = $parts;

        $headerJson = $this->base64UrlDecode($header64);
        $payloadJson = $this->base64UrlDecode($payload64);
        $sig = $this->base64UrlDecode($sig64);

        $header = json_decode($headerJson, true);
        $payload = json_decode($payloadJson, true);

        if (!is_array($header) || !is_array($payload)) {
            throw new \RuntimeException('Invalid JWT JSON');
        }

        if (($header['alg'] ?? null) !== 'HS256') {
            throw new \RuntimeException('Unsupported alg');
        }

        $toSign = $header64 . '.' . $payload64;
        $expected = hash_hmac('sha256', $toSign, $secret, true);
        if (!hash_equals($expected, $sig)) {
            throw new \RuntimeException('Bad signature');
        }

        $now = time();
        $exp = isset($payload['exp']) ? (int) $payload['exp'] : null;
        if ($exp !== null && $now >= $exp) {
            throw new \RuntimeException('Token expired');
        }

        $nbf = isset($payload['nbf']) ? (int) $payload['nbf'] : null;
        if ($nbf !== null && $now < $nbf) {
            throw new \RuntimeException('Token not active');
        }

        return $payload;
    }

    private function base64UrlDecode(string $data): string
    {
        $remainder = strlen($data) % 4;
        if ($remainder !== 0) {
            $data .= str_repeat('=', 4 - $remainder);
        }
        $decoded = base64_decode(strtr($data, '-_', '+/'), true);
        if ($decoded === false) {
            throw new \RuntimeException('Invalid base64');
        }
        return $decoded;
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function createSession(string $xrpcHost, string $identifier, string $password): array
    {
        $client = $this->makeHttpClient();

        try {
            $resp = $client->post($xrpcHost . '/xrpc/com.atproto.server.createSession', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                ],
                'body' => (string) json_encode([
                    'identifier' => $identifier,
                    'password' => $password,
                ], JSON_UNESCAPED_SLASHES),
            ]);
        } catch (\Throwable $e) {
            $this->sendJson(
                [
                    'error' => 'upstream_unreachable',
                    'status' => 502,
                    'message' => 'Failed to connect to configured XRPC host.',
                ],
                502
            );
        }

        $status = $resp->getStatusCode();
        $body = (string) $resp->getBody();
        $json = json_decode($body, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            $this->sendJson(
                [
                    'error' => 'auth_failed',
                    'status' => $status,
                    'message' => 'Failed to create ATProto session with configured credentials.',
                ],
                502
            );
        }

        $access = (string) ($json['accessJwt'] ?? '');
        $did = (string) ($json['did'] ?? '');

        if ($access === '' || $did === '') {
            $this->sendJson(
                [
                    'error' => 'auth_failed',
                    'status' => 502,
                    'message' => 'ATProto session response missing accessJwt/did.',
                ],
                502
            );
        }

        return [$access, $did];
    }

    private function makeHttpClient(): Client
    {
        return new Client([
            'timeout' => 10,
            'connect_timeout' => 5,
            'http_errors' => false,
        ]);
    }

    private function getAtprotoXrpcHost(): string
    {
        $host = (string) Config::get('xavi_social.atproto.xrpc_host');
        if ($host === '') {
            $env = getenv('XAVI_SOCIAL_ATPROTO_XRPC_HOST');
            $host = $env === false ? '' : (string) $env;
        }

        $host = trim($host);
        return rtrim($host, '/');
    }

    private function getAtprotoIdentifier(): string
    {
        $identifier = (string) Config::get('xavi_social.atproto.identifier');
        if ($identifier === '') {
            $env = getenv('XAVI_SOCIAL_ATPROTO_IDENTIFIER');
            $identifier = $env === false ? '' : (string) $env;
        }

        return trim($identifier);
    }

    private function getAtprotoPassword(): string
    {
        $password = (string) Config::get('xavi_social.atproto.password');
        if ($password === '') {
            $env = getenv('XAVI_SOCIAL_ATPROTO_PASSWORD');
            $password = $env === false ? '' : (string) $env;
        }

        return (string) $password;
    }

    private function sendJson(array $payload, int $status = 200): void
    {
        $response = new JsonResponse($payload, $status);
        $response->setEncodingOptions(JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('Content-Type', 'application/json; charset=utf-8');

        $response->send();
        exit;
    }
}
