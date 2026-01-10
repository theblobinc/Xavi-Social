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

class Profile extends PageController
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

        $actor = trim((string) $this->request->query->get('actor', ''));

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
        $handle = trim((string) ($localAccount['handle'] ?? ''));
        $pdsUrl = trim((string) ($localAccount['pdsUrl'] ?? ''));
        $accountId = (int) ($localAccount['id'] ?? 0);

        if ($actor === '') {
            $actor = $handle !== '' ? $handle : $did;
        }

        if ($actor === '') {
            $this->sendJson([
                'error' => 'bad_request',
                'message' => 'Missing actor (and local account missing handle/did).',
            ], 400);
        }

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

        if ($accessJwt === '') {
            $this->sendJson([
                'error' => 'local_account_missing_tokens',
                'message' => 'Local account missing access token.',
            ], 409);
        }

        $out = $this->fetchProfileWithJwt($pdsHttp, $accessJwt, $actor);
        if (($out['status'] ?? 0) === 401 || ($out['status'] ?? 0) === 403) {
            if ($refreshJwt !== '' && $accountId > 0) {
                try {
                    [$newAccess, $newRefresh] = $this->refreshLocalSession($pdsHttp, $refreshJwt);
                    $this->storeLocalTokens($accountId, $newAccess, $newRefresh);
                    $out = $this->fetchProfileWithJwt($pdsHttp, $newAccess, $actor);
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
                'message' => 'Failed to fetch profile.',
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
            'actor' => $actor,
            'profile' => $out['profile'] ?? null,
            'feed' => $out['feed'] ?? [],
        ]);
    }

    /**
     * @return array{ok: bool, status: int, profile?: array<string,mixed>|null, feed?: array<int,array<string,mixed>>, error?: string, message?: string, raw?: string}
     */
    private function fetchProfileWithJwt(string $origin, string $accessJwt, string $actor): array
    {
        $client = $this->makeHttpClient();

        try {
            $profileResp = $client->get(rtrim($origin, '/') . '/xrpc/app.bsky.actor.getProfile', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'actor' => $actor,
                ],
            ]);
        } catch (\Throwable $e) {
            return ['ok' => false, 'status' => 502];
        }

        $profileStatus = $profileResp->getStatusCode();
        $profileRaw = (string) $profileResp->getBody();
        $profileJson = json_decode($profileRaw, true);

        if ($profileStatus === 404 || ($profileStatus === 400 && is_array($profileJson) && $this->isXrpcMethodNotSupported($profileJson))) {
            return $this->fetchProfileFromRepo($origin, $accessJwt, $actor);
        }

        if ($profileStatus < 200 || $profileStatus >= 300 || !is_array($profileJson)) {
            if (is_array($profileJson) && $profileStatus === 400) {
                $err = trim((string) ($profileJson['error'] ?? ''));
                $msg = trim((string) ($profileJson['message'] ?? ''));
                if (
                    ($err !== '' && stripos($err, 'ExpiredToken') !== false) ||
                    ($msg !== '' && stripos($msg, 'expired') !== false)
                ) {
                    return ['ok' => false, 'status' => 401, 'error' => $err, 'message' => $msg, 'raw' => trim(substr($profileRaw, 0, 2000))];
                }

                return [
                    'ok' => false,
                    'status' => $profileStatus,
                    'error' => $err !== '' ? $err : 'upstream_error',
                    'message' => $msg !== '' ? $msg : ('PDS getProfile failed (HTTP ' . $profileStatus . ')'),
                    'raw' => trim(substr($profileRaw, 0, 2000)),
                ];
            }

            return ['ok' => false, 'status' => $profileStatus];
        }

        try {
            $feedResp = $client->get(rtrim($origin, '/') . '/xrpc/app.bsky.feed.getAuthorFeed', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'actor' => $actor,
                    'limit' => 15,
                ],
            ]);
        } catch (\Throwable $e) {
            return ['ok' => false, 'status' => 502];
        }

        $feedStatus = $feedResp->getStatusCode();
        $feedRaw = (string) $feedResp->getBody();
        $feedJson = json_decode($feedRaw, true);

        if ($feedStatus === 404 || ($feedStatus === 400 && is_array($feedJson) && $this->isXrpcMethodNotSupported($feedJson))) {
            return $this->fetchProfileFromRepo($origin, $accessJwt, $actor);
        }

        if ($feedStatus < 200 || $feedStatus >= 300 || !is_array($feedJson)) {
            if (is_array($feedJson) && $feedStatus === 400) {
                $err = trim((string) ($feedJson['error'] ?? ''));
                $msg = trim((string) ($feedJson['message'] ?? ''));
                if (
                    ($err !== '' && stripos($err, 'ExpiredToken') !== false) ||
                    ($msg !== '' && stripos($msg, 'expired') !== false)
                ) {
                    return ['ok' => false, 'status' => 401, 'error' => $err, 'message' => $msg, 'raw' => trim(substr($feedRaw, 0, 2000))];
                }

                return [
                    'ok' => false,
                    'status' => $feedStatus,
                    'error' => $err !== '' ? $err : 'upstream_error',
                    'message' => $msg !== '' ? $msg : ('PDS getAuthorFeed failed (HTTP ' . $feedStatus . ')'),
                    'raw' => trim(substr($feedRaw, 0, 2000)),
                ];
            }

            return ['ok' => false, 'status' => $feedStatus];
        }

        $items = [];
        $feed = $feedJson['feed'] ?? [];
        if (is_array($feed)) {
            foreach ($feed as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $post = $row['post'] ?? null;
                if (!is_array($post)) {
                    continue;
                }
                $items[] = $this->normalizePostView($post);
            }
        }

        return [
            'ok' => true,
            'status' => 200,
            'profile' => $profileJson,
            'feed' => $items,
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

    /**
     * Fallback for pure PDS: build a minimal profile from repo metadata and listRecords.
     *
     * @return array{ok: bool, status: int, profile?: array<string,mixed>|null, feed?: array<int,array<string,mixed>>}
     */
    private function fetchProfileFromRepo(string $origin, string $accessJwt, string $actor): array
    {
        $repoDid = $actor;
        if (stripos($actor, 'did:') !== 0) {
            $resolved = $this->resolveHandleToDid($origin, $accessJwt, $actor);
            if ($resolved !== '') {
                $repoDid = $resolved;
            }
        }

        $repoInfo = $this->describeRepo($origin, $accessJwt, $repoDid);
        $handle = (string) ($repoInfo['handle'] ?? '');
        $did = (string) ($repoInfo['did'] ?? $repoDid);
        if ($did === '') {
            $did = $repoDid;
        }

        $profile = [
            'did' => $did,
            'handle' => $handle !== '' ? $handle : $actor,
            'displayName' => $handle !== '' ? $handle : $actor,
            'description' => '',
        ];

        $feed = $this->listPostRecords($origin, $accessJwt, $did, 15);

        return [
            'ok' => true,
            'status' => 200,
            'profile' => $profile,
            'feed' => $feed,
        ];
    }

    private function resolveHandleToDid(string $origin, string $accessJwt, string $handle): string
    {
        $client = $this->makeHttpClient();
        try {
            $resp = $client->get(rtrim($origin, '/') . '/xrpc/com.atproto.identity.resolveHandle', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'handle' => $handle,
                ],
            ]);
        } catch (\Throwable $e) {
            return '';
        }

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            return '';
        }

        return trim((string) ($json['did'] ?? ''));
    }

    /**
     * @return array{did?: string, handle?: string}
     */
    private function describeRepo(string $origin, string $accessJwt, string $repo): array
    {
        $client = $this->makeHttpClient();
        try {
            $resp = $client->get(rtrim($origin, '/') . '/xrpc/com.atproto.repo.describeRepo', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'repo' => $repo,
                ],
            ]);
        } catch (\Throwable $e) {
            return [];
        }

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            return [];
        }

        return [
            'did' => (string) ($json['did'] ?? ''),
            'handle' => (string) ($json['handle'] ?? ''),
        ];
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function listPostRecords(string $origin, string $accessJwt, string $repoDid, int $limit): array
    {
        $client = $this->makeHttpClient();

        try {
            $resp = $client->get(rtrim($origin, '/') . '/xrpc/com.atproto.repo.listRecords', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'repo' => $repoDid,
                    'collection' => 'app.bsky.feed.post',
                    'limit' => $limit,
                ],
            ]);
        } catch (\Throwable $e) {
            return [];
        }

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            return [];
        }

        $records = $json['records'] ?? [];
        if (!is_array($records)) {
            return [];
        }

        $items = [];
        foreach ($records as $r) {
            if (!is_array($r)) {
                continue;
            }

            $value = $r['value'] ?? null;
            if (!is_array($value)) {
                continue;
            }

            $createdAt = (string) ($value['createdAt'] ?? '');
            $items[] = [
                'uri' => (string) ($r['uri'] ?? ''),
                'cid' => (string) ($r['cid'] ?? ''),
                'text' => (string) ($value['text'] ?? ''),
                'createdAt' => $createdAt,
                'indexedAt' => $createdAt,
                'author' => [
                    'did' => $repoDid,
                    'handle' => $repoDid,
                    'displayName' => $repoDid,
                    'avatar' => '',
                ],
                'replyCount' => null,
                'repostCount' => null,
                'likeCount' => null,
            ];
        }

        usort($items, static function (array $a, array $b): int {
            $at = (string) ($a['createdAt'] ?? '');
            $bt = (string) ($b['createdAt'] ?? '');
            return strcmp($bt, $at);
        });

        if (count($items) > $limit) {
            $items = array_slice($items, 0, $limit);
        }

        return $items;
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
