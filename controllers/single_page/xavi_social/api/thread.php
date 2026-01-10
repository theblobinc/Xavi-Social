<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api;

use Concrete\Package\XaviSocial\Atproto\LocalPdsProvisioner;
use Concrete\Package\XaviSocial\Crypto\TokenCipher;
use Concrete\Core\Http\Request;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Support\Facade\Config;
use Concrete\Core\User\User;
use GuzzleHttp\Client;
use Symfony\Component\HttpFoundation\JsonResponse;

class Thread extends PageController
{
    public function view(): void
    {
        [$authMethod, $user] = $this->authenticate();
        if ($user === null || !$user->isRegistered()) {
            $this->sendJson([
                'error' => 'not_authenticated',
                'message' => 'Concrete login (cookie) or Bearer JWT required.',
            ], 401);
        }

        $uri = trim((string) $this->request->query->get('uri', ''));
        if ($uri === '') {
            $this->sendJson([
                'error' => 'bad_request',
                'message' => 'Missing required query param: uri',
            ], 400);
        }

        $userId = (int) $user->getUserID();

        $localAccount = $this->getLocalPdsAccountRow($userId);
        if (!is_array($localAccount)) {
            try {
                $provisioner = new LocalPdsProvisioner($this->app);
                $res = $provisioner->ensureLocalAccountForUserId($userId);
                $localAccount = isset($res['account']) && is_array($res['account']) ? $res['account'] : null;
            } catch (\Throwable $e) {
                $localAccount = null;
            }
        }

        if (!is_array($localAccount)) {
            $this->sendJson([
                'error' => 'no_local_account',
                'message' => 'No local PDS account is available for this user.',
            ], 409);
        }

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

        if ($did === '' || $accessJwt === '') {
            $this->sendJson([
                'error' => 'local_account_missing_tokens',
                'message' => 'Local account missing DID or access token.',
            ], 409);
        }

        $out = $this->fetchThreadWithJwt($pdsHttp, $accessJwt, $uri);
        if (($out['status'] ?? 0) === 401 || ($out['status'] ?? 0) === 403) {
            if ($refreshJwt !== '' && $accountId > 0) {
                try {
                    [$newAccess, $newRefresh] = $this->refreshLocalSession($pdsHttp, $refreshJwt);
                    $this->storeLocalTokens($accountId, $newAccess, $newRefresh);
                    $out = $this->fetchThreadWithJwt($pdsHttp, $newAccess, $uri);
                } catch (\Throwable $e) {
                    // ignore
                }
            }
        }

        if (($out['ok'] ?? false) !== true) {
            $status = (int) ($out['status'] ?? 502);
            if ($status < 400 || $status > 599) {
                $status = 502;
            }

            $payload = [
                'error' => 'upstream_error',
                'message' => 'Failed to fetch thread.',
                'status' => $status,
                'upstream' => [
                    'origin' => $pdsHttp,
                    'status' => $status,
                ],
            ];

            if (isset($out['error']) && is_string($out['error']) && $out['error'] !== '') {
                $payload['upstream']['error'] = $out['error'];
            }
            if (isset($out['message']) && is_string($out['message']) && $out['message'] !== '') {
                $payload['upstream']['message'] = $out['message'];
            }
            if (isset($out['raw']) && is_string($out['raw']) && $out['raw'] !== '') {
                $payload['upstream']['raw'] = $out['raw'];
            }

            $this->sendJson($payload, $status);
        }

        $this->sendJson([
            'ok' => true,
            'source' => 'atproto',
            'mode' => 'pds_user',
            'authMethod' => $authMethod,
            'viewerDid' => $did,
            'uri' => $uri,
            'post' => $out['post'] ?? null,
            'replies' => $out['replies'] ?? [],
        ]);
    }

    /**
     * @return array{ok: bool, status: int, post?: array<string,mixed>|null, replies?: array<int,array<string,mixed>>, error?: string, message?: string, raw?: string}
     */
    private function fetchThreadWithJwt(string $origin, string $accessJwt, string $uri): array
    {
        $client = $this->makeHttpClient();

        try {
            $resp = $client->get(rtrim($origin, '/') . '/xrpc/app.bsky.feed.getPostThread', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'uri' => $uri,
                    'depth' => 1,
                    'parentHeight' => 0,
                ],
            ]);
        } catch (\Throwable $e) {
            return ['ok' => false, 'status' => 502];
        }

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status === 404 || ($status === 400 && is_array($json) && $this->isXrpcMethodNotSupported($json))) {
            // Pure PDS setups typically don't have an AppView; build a minimal thread from the record.
            return $this->fetchThreadFromRecord($origin, $accessJwt, $uri);
        }

        if ($status === 400 && is_array($json) && $this->isRecordMissing($json)) {
            // Some PDS builds return InvalidRequest/"Could not locate record" instead of 404 when the
            // AppView side is absent. Fall back to a repo.getRecord fetch in that case as well.
            return $this->fetchThreadFromRecord($origin, $accessJwt, $uri);
        }

        if ($status === 400 && is_array($json) && $this->isRecordMissing($json)) {
            // Some PDS builds return InvalidRequest/"Could not locate record" instead of 404 when the
            // AppView side is absent. Fall back to a repo.getRecord fetch in that case as well.
            return $this->fetchThreadFromRecord($origin, $accessJwt, $uri);
        }

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            if (is_array($json) && $status === 400) {
                $err = trim((string) ($json['error'] ?? ''));
                $msg = trim((string) ($json['message'] ?? ''));
                if (
                    ($err !== '' && stripos($err, 'ExpiredToken') !== false) ||
                    ($msg !== '' && stripos($msg, 'expired') !== false)
                ) {
                    return ['ok' => false, 'status' => 401, 'error' => $err, 'message' => $msg, 'raw' => trim(substr($raw, 0, 2000))];
                }

                return [
                    'ok' => false,
                    'status' => $status,
                    'error' => $err !== '' ? $err : 'upstream_error',
                    'message' => $msg !== '' ? $msg : ('PDS getPostThread failed (HTTP ' . $status . ')'),
                    'raw' => trim(substr($raw, 0, 2000)),
                ];
            }

            return ['ok' => false, 'status' => $status];
        }

        $thread = $json['thread'] ?? null;
        if (!is_array($thread)) {
            return ['ok' => false, 'status' => 502];
        }

        $rootPost = null;
        if (isset($thread['post']) && is_array($thread['post'])) {
            $rootPost = $this->normalizePostView($thread['post']);
        }

        $replies = [];
        $repliesRaw = $thread['replies'] ?? [];
        if (is_array($repliesRaw)) {
            foreach ($repliesRaw as $node) {
                if (!is_array($node)) {
                    continue;
                }
                $pv = $node['post'] ?? null;
                if (!is_array($pv)) {
                    continue;
                }
                $replies[] = $this->normalizePostView($pv);
            }
        }

        return [
            'ok' => true,
            'status' => $status,
            'post' => $rootPost,
            'replies' => $replies,
        ];
    }

    /**
     * Fallback for pure PDS: fetch the root post via com.atproto.repo.getRecord.
     *
     * @return array{ok: bool, status: int, post?: array<string,mixed>|null, replies?: array<int,array<string,mixed>>, error?: string, message?: string, raw?: string}
     */
    private function fetchThreadFromRecord(string $origin, string $accessJwt, string $uri): array
    {
        $parsed = $this->parseAtUri($uri);
        if ($parsed === null) {
            return ['ok' => false, 'status' => 400];
        }

        [$repo, $collection, $rkey] = $parsed;

        $client = $this->makeHttpClient();
        try {
            $resp = $client->get(rtrim($origin, '/') . '/xrpc/com.atproto.repo.getRecord', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'repo' => $repo,
                    'collection' => $collection,
                    'rkey' => $rkey,
                ],
            ]);
        } catch (\Throwable $e) {
            return ['ok' => false, 'status' => 502];
        }

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            if (is_array($json) && $status === 400) {
                $err = trim((string) ($json['error'] ?? ''));
                $msg = trim((string) ($json['message'] ?? ''));
                if (
                    ($err !== '' && stripos($err, 'ExpiredToken') !== false) ||
                    ($msg !== '' && stripos($msg, 'expired') !== false)
                ) {
                    return ['ok' => false, 'status' => 401, 'error' => $err, 'message' => $msg, 'raw' => trim(substr($raw, 0, 2000))];
                }

                return [
                    'ok' => false,
                    'status' => $status,
                    'error' => $err !== '' ? $err : 'upstream_error',
                    'message' => $msg !== '' ? $msg : ('PDS getRecord failed (HTTP ' . $status . ')'),
                    'raw' => trim(substr($raw, 0, 2000)),
                ];
            }

            return ['ok' => false, 'status' => $status];
        }

        $value = $json['value'] ?? null;
        if (!is_array($value)) {
            $value = [];
        }

        $createdAt = (string) ($value['createdAt'] ?? '');
        $post = [
            'uri' => $uri,
            'cid' => (string) ($json['cid'] ?? ''),
            'text' => (string) ($value['text'] ?? ''),
            'createdAt' => $createdAt,
            'indexedAt' => $createdAt,
            'author' => [
                'did' => $repo,
                'handle' => $repo,
                'displayName' => $repo,
                'avatar' => '',
            ],
            'replyCount' => null,
            'repostCount' => null,
            'likeCount' => null,
        ];

        return [
            'ok' => true,
            'status' => 200,
            'post' => $post,
            'replies' => [],
        ];
    }

    private function isXrpcMethodNotSupported(array $json): bool
    {
        $err = strtolower(trim((string) ($json['error'] ?? '')));
        $msg = strtolower(trim((string) ($json['message'] ?? '')));

        if ($err === 'invalidrequest' && $msg !== '' && str_contains($msg, 'no service configured for')) {
            return true;
        }

        if ($err !== '' && (str_contains($err, 'methodnotfound') || str_contains($err, 'notimplemented') || str_contains($err, 'notsupported') || str_contains($err, 'xrpcnotsupported'))) {
            return true;
        }

        if ($msg !== '' && (str_contains($msg, 'method') && (str_contains($msg, 'not found') || str_contains($msg, 'not supported') || str_contains($msg, 'not implemented')))) {
            return true;
        }

        return false;
    }

    private function isRecordMissing(array $json): bool
    {
        $err = strtolower(trim((string) ($json['error'] ?? '')));
        $msg = strtolower(trim((string) ($json['message'] ?? '')));

        if ($msg !== '' && (str_contains($msg, 'could not locate record') || str_contains($msg, 'record not found'))) {
            return true;
        }

        if ($err !== '' && (str_contains($err, 'recordnotfound') || str_contains($err, 'norecord'))) {
            return true;
        }

        return false;
    }

    private function isRecordMissing(array $json): bool
    {
        $err = strtolower(trim((string) ($json['error'] ?? '')));
        $msg = strtolower(trim((string) ($json['message'] ?? '')));

        if ($msg !== '' && (str_contains($msg, 'could not locate record') || str_contains($msg, 'record not found'))) {
            return true;
        }

        if ($err !== '' && (str_contains($err, 'recordnotfound') || str_contains($err, 'norecord'))) {
            return true;
        }

        return false;
    }

    /**
     * @return array{0: string, 1: string, 2: string}|null
     */
    private function parseAtUri(string $uri): ?array
    {
        $u = trim($uri);
        if (stripos($u, 'at://') !== 0) {
            return null;
        }

        $rest = substr($u, 5);
        $parts = explode('/', $rest);
        if (count($parts) < 3) {
            return null;
        }

        $repo = trim((string) $parts[0]);
        $collection = trim((string) $parts[1]);
        $rkey = trim((string) $parts[2]);

        if ($repo === '' || $collection === '' || $rkey === '') {
            return null;
        }

        return [$repo, $collection, $rkey];
    }

    /**
     * @return array<string,mixed>
     */
    private function normalizePostView(array $postView): array
    {
        $record = isset($postView['record']) && is_array($postView['record']) ? $postView['record'] : [];
        $author = isset($postView['author']) && is_array($postView['author']) ? $postView['author'] : [];

        $createdAt = (string) ($record['createdAt'] ?? '');

        return [
            'uri' => (string) ($postView['uri'] ?? ''),
            'cid' => (string) ($postView['cid'] ?? ''),
            'text' => (string) ($record['text'] ?? ''),
            'createdAt' => $createdAt,
            'indexedAt' => $createdAt,
            'author' => [
                'did' => (string) ($author['did'] ?? ''),
                'handle' => (string) ($author['handle'] ?? ''),
                'displayName' => (string) (($author['displayName'] ?? '') ?: ($author['handle'] ?? '')),
                'avatar' => (string) ($author['avatar'] ?? ''),
            ],
            'replyCount' => isset($postView['replyCount']) ? (int) $postView['replyCount'] : null,
            'repostCount' => isset($postView['repostCount']) ? (int) $postView['repostCount'] : null,
            'likeCount' => isset($postView['likeCount']) ? (int) $postView['likeCount'] : null,
        ];
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
        if ($this->isDockerRuntime()) {
            $override = getenv('XAVI_SOCIAL_INTERNAL_HTTP_ORIGIN');
            if ($override !== false && trim((string) $override) !== '') {
                return rtrim(trim((string) $override), '/');
            }

            return 'http://nginx';
        }

        $override = getenv('XAVI_SOCIAL_INTERNAL_HTTP_ORIGIN');
        if ($override !== false && trim((string) $override) !== '') {
            return rtrim(trim((string) $override), '/');
        }

        $host = (string) parse_url($publicOrigin, PHP_URL_HOST);
        $host = strtolower(trim($host));

        if ($host === '' || $host === 'localhost' || $host === '127.0.0.1' || $host === '0.0.0.0') {
            return 'http://nginx';
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

    private function makeHttpClient(): Client
    {
        return new Client([
            'timeout' => 10,
            'connect_timeout' => 5,
            'http_errors' => false,
        ]);
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
