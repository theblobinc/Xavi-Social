<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api;

use Concrete\Package\XaviSocial\Crypto\TokenCipher;
use Concrete\Core\Http\Request;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Support\Facade\Config;
use Concrete\Core\User\User;
use Concrete\Package\XaviSocial\Atproto\LocalPdsProvisioner;
use Concrete\Package\XaviSocial\Storage\Postgres;
use GuzzleHttp\Client;
use Symfony\Component\HttpFoundation\JsonResponse;

class Feed extends PageController
{
    public function view(): void
    {
        $payload = $this->fetchLocalOrGlobalTimeline();

        // Only merge public cached posts into the non-user (public/global) feed.
        $mode = (string) ($payload['mode'] ?? '');
        if ($mode !== 'pds_user') {
            $limit = (int) $this->request->query->get('limit', 30);
            if ($limit <= 0) {
                $limit = 30;
            }
            if ($limit > 100) {
                $limit = 100;
            }

            $baseItems = [];
            if (isset($payload['items']) && is_array($payload['items'])) {
                $baseItems = $payload['items'];
            }

            $cachedCursorIn = (string) $this->request->query->get('cachedCursor', '');
            [$cachedItems, $cachedCursorOut] = $this->fetchCachedPublicTimeline($limit, $cachedCursorIn);
            if ($cachedCursorOut !== '') {
                $payload['cachedCursor'] = $cachedCursorOut;
            }
            if (!empty($cachedItems)) {
                $payload['items'] = $this->mergeAndSortItems($baseItems, $cachedItems, $limit);
            }
        }

        $this->sendJson($payload);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function fetchCachedPublicTimeline(int $limit, string $cursor): array
    {
        $pdo = Postgres::connect();
        if (!$pdo) {
            return [[], ''];
        }

        try {
            Postgres::ensureSchema($pdo);
        } catch (\Throwable $e) {
            return [[], ''];
        }

        if ($limit <= 0) {
            $limit = 30;
        }
        if ($limit > 100) {
            $limit = 100;
        }

        $cursorTs = null;
        $cursorUri = '';
        $cursor = trim($cursor);
        if ($cursor !== '') {
            $parts = explode('|', $cursor, 2);
            if (count($parts) === 2) {
                $cursorTs = trim($parts[0]);
                $cursorUri = trim($parts[1]);
            }
        }

        try {
            $sql =
                "SELECT raw, updated_at, uri\n" .
                "FROM xavi_social_cached_posts\n" .
                "WHERE audience = 'public'\n";

            if ($cursorTs !== null && $cursorUri !== '') {
                $sql .=
                    "  AND (updated_at < :cursor_ts OR (updated_at = :cursor_ts AND uri < :cursor_uri))\n";
            }

            $sql .=
                "ORDER BY updated_at DESC, uri DESC\n" .
                "LIMIT :limit";

            $stmt = $pdo->prepare($sql);
            if ($cursorTs !== null && $cursorUri !== '') {
                $stmt->bindValue('cursor_ts', $cursorTs, \PDO::PARAM_STR);
                $stmt->bindValue('cursor_uri', $cursorUri, \PDO::PARAM_STR);
            }
            $stmt->bindValue('limit', $limit, \PDO::PARAM_INT);
            $stmt->execute();
            $rows = $stmt->fetchAll();
        } catch (\Throwable $e) {
            return [[], ''];
        }

        if (!is_array($rows)) {
            return [[], ''];
        }

        $nextCursor = '';
        if (!empty($rows)) {
            $last = $rows[count($rows) - 1];
            if (is_array($last)) {
                $lastUpdated = (string) ($last['updated_at'] ?? '');
                $lastUri = (string) ($last['uri'] ?? '');
                if ($lastUpdated !== '' && $lastUri !== '') {
                    $nextCursor = $lastUpdated . '|' . $lastUri;
                }
            }
        }

        $out = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }

            $raw = $row['raw'] ?? null;
            if (is_string($raw)) {
                $item = json_decode($raw, true);
            } else {
                $item = $raw;
            }

            if (!is_array($item)) {
                continue;
            }

            $uri = trim((string) ($item['uri'] ?? ''));
            if ($uri === '') {
                continue;
            }

            $author = $item['author'] ?? null;
            if (!is_array($author)) {
                $author = [];
            }

            $out[] = [
                'uri' => $uri,
                'cid' => (string) ($item['cid'] ?? ''),
                'text' => (string) ($item['text'] ?? ''),
                'createdAt' => (string) ($item['createdAt'] ?? ''),
                'indexedAt' => (string) ($item['indexedAt'] ?? ''),
                'author' => [
                    'did' => (string) ($author['did'] ?? ''),
                    'handle' => (string) ($author['handle'] ?? ''),
                    'displayName' => (string) ($author['displayName'] ?? ''),
                    'avatar' => (string) ($author['avatar'] ?? ''),
                ],
            ];
        }

        return [$out, $nextCursor];
    }

    /**
     * @param array<int,array<string,mixed>> $a
     * @param array<int,array<string,mixed>> $b
     * @return array<int,array<string,mixed>>
     */
    private function mergeAndSortItems(array $a, array $b, int $limit): array
    {
        $seen = [];
        $out = [];

        foreach ([$a, $b] as $items) {
            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $uri = (string) ($item['uri'] ?? '');
                if ($uri === '' || isset($seen[$uri])) {
                    continue;
                }
                $seen[$uri] = true;
                $out[] = $item;
            }
        }

        usort($out, static function (array $x, array $y): int {
            $tx = strtotime((string) ($x['indexedAt'] ?? $x['createdAt'] ?? '')) ?: 0;
            $ty = strtotime((string) ($y['indexedAt'] ?? $y['createdAt'] ?? '')) ?: 0;
            return $ty <=> $tx;
        });

        if ($limit > 0 && count($out) > $limit) {
            $out = array_slice($out, 0, $limit);
        }

        return $out;
    }

    /**
     * If a Concrete user is logged in, prefer their local PDS account (tokens stored server-side).
     * Otherwise fall back to the configured global timeline (or mock).
     *
     * @return array<string,mixed>
     */
    private function fetchLocalOrGlobalTimeline(): array
    {
        $cookieUser = $this->app->make(User::class);
        if ($cookieUser && $cookieUser->isRegistered()) {
            $userId = (int) $cookieUser->getUserID();

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
                    $limit = (int) $this->request->query->get('limit', 30);
                    if ($limit <= 0) {
                        $limit = 30;
                    }
                    if ($limit > 100) {
                        $limit = 100;
                    }

                    $out = $this->listRecordsWithJwt($pdsHttp, $accessJwt, $did, $limit);
                    if (($out['status'] ?? 0) === 401 || ($out['status'] ?? 0) === 403) {
                        if ($refreshJwt !== '' && $accountId > 0) {
                            try {
                                [$newAccess, $newRefresh] = $this->refreshLocalSession($pdsHttp, $refreshJwt);
                                $this->storeLocalTokens($accountId, $newAccess, $newRefresh);
                                $out = $this->listRecordsWithJwt($pdsHttp, $newAccess, $did, $limit);
                            } catch (\Throwable $e) {
                                // ignore
                            }
                        }
                    }

                    if (($out['ok'] ?? false) === true) {
                        return [
                            'source' => 'atproto',
                            'mode' => 'pds_user',
                            'viewerDid' => $did,
                            'cursor' => '',
                            'items' => $out['items'] ?? [],
                        ];
                    }
                }
            }
        }

        return $this->fetchTimeline();
    }

    /**
     * @return array<string,mixed>
     */
    private function fetchTimeline(): array
    {
        $xrpcHost = $this->getAtprotoXrpcHost();
        $identifier = $this->getAtprotoIdentifier();
        $password = $this->getAtprotoPassword();
        $mode = $this->getAtprotoMode();

        if ($xrpcHost === '' || $identifier === '' || $password === '') {
            return $this->mockTimeline();
        }

        $limit = (int) $this->request->query->get('limit', 30);
        if ($limit <= 0) {
            $limit = 30;
        }
        if ($limit > 100) {
            $limit = 100;
        }

        $cursor = (string) $this->request->query->get('cursor', '');

        [$accessJwt, $did] = $this->createSession($xrpcHost, $identifier, $password);

        if ($mode === 'pds') {
            return $this->fetchPdsTimeline($xrpcHost, $accessJwt, $did, $limit);
        }

        $query = ['limit' => $limit];
        if ($cursor !== '') {
            $query['cursor'] = $cursor;
        }

        $client = $this->makeHttpClient();
        try {
            $resp = $client->get($xrpcHost . '/xrpc/app.bsky.feed.getTimeline', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => $query,
            ]);
        } catch (\Throwable $e) {
            return [
                'source' => 'atproto',
                'mode' => 'appview',
                'error' => 'upstream_unreachable',
                'message' => 'Failed to connect to configured XRPC host.',
            ];
        }

        $status = $resp->getStatusCode();
        $body = (string) $resp->getBody();
        $json = json_decode($body, true);

        if ($status === 404) {
            return $this->fetchPdsTimeline($xrpcHost, $accessJwt, $did, $limit);
        }

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            return [
                'source' => 'atproto',
                'mode' => 'appview',
                'error' => 'upstream_error',
                'status' => $status,
                'message' => 'Failed to fetch timeline from configured XRPC host.',
            ];
        }

        $items = [];
        $feed = $json['feed'] ?? [];
        if (is_array($feed)) {
            foreach ($feed as $entry) {
                if (!is_array($entry)) {
                    continue;
                }

                $post = $entry['post'] ?? null;
                if (!is_array($post)) {
                    continue;
                }

                $record = $post['record'] ?? null;
                if (!is_array($record)) {
                    continue;
                }

                $author = $post['author'] ?? null;
                if (!is_array($author)) {
                    $author = [];
                }

                $items[] = [
                    'uri' => (string) ($post['uri'] ?? ''),
                    'cid' => (string) ($post['cid'] ?? ''),
                    'text' => (string) ($record['text'] ?? ''),
                    'createdAt' => (string) ($record['createdAt'] ?? ''),
                    'indexedAt' => (string) ($post['indexedAt'] ?? ''),
                    'author' => [
                        'did' => (string) ($author['did'] ?? ''),
                        'handle' => (string) ($author['handle'] ?? ''),
                        'displayName' => (string) ($author['displayName'] ?? ''),
                        'avatar' => (string) ($author['avatar'] ?? ''),
                    ],
                ];
            }
        }

        return [
            'source' => 'atproto',
            'mode' => 'appview',
            'viewerDid' => $did,
            'cursor' => (string) ($json['cursor'] ?? ''),
            'items' => $items,
        ];
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
     * @return array{ok: bool, status: int, items?: array<int,array<string,mixed>>}
     */
    private function listRecordsWithJwt(string $origin, string $accessJwt, string $did, int $limit): array
    {
        $client = $this->makeHttpClient();

        try {
            $resp = $client->get(rtrim($origin, '/') . '/xrpc/com.atproto.repo.listRecords', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'repo' => $did,
                    'collection' => 'app.bsky.feed.post',
                    'limit' => $limit,
                ],
            ]);
        } catch (\Throwable $e) {
            return ['ok' => false, 'status' => 502];
        }

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            return ['ok' => false, 'status' => $status];
        }

        $records = $json['records'] ?? [];
        if (!is_array($records)) {
            $records = [];
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
            $items[] = [
                'uri' => (string) ($r['uri'] ?? ''),
                'cid' => (string) ($r['cid'] ?? ''),
                'text' => (string) ($value['text'] ?? ''),
                'createdAt' => (string) ($value['createdAt'] ?? ''),
                'indexedAt' => (string) ($value['createdAt'] ?? ''),
                'author' => [
                    'did' => $did,
                    'handle' => $did,
                    'displayName' => $did,
                    'avatar' => '',
                ],
            ];
        }

        return ['ok' => true, 'status' => $status, 'items' => $items];
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
     * PDS-only timeline builder.
     *
     * When you host your own PDS as the XRPC host, you typically do not have an AppView,
     * so app.bsky.feed.getTimeline will not exist. This builds a simple feed from repo records.
     *
     * @return array<string,mixed>
     */
    private function fetchPdsTimeline(string $xrpcHost, string $accessJwt, string $viewerDid, int $limit): array
    {
        $dids = $this->getAtprotoPublicDids();
        if ($dids === []) {
            $dids = [$viewerDid];
        }

        $client = $this->makeHttpClient();
        $items = [];

        foreach ($dids as $repoDid) {
            try {
                $resp = $client->get($xrpcHost . '/xrpc/com.atproto.repo.listRecords', [
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
                continue;
            }

            $status = $resp->getStatusCode();
            $body = (string) $resp->getBody();
            $json = json_decode($body, true);

            if ($status < 200 || $status >= 300 || !is_array($json)) {
                continue;
            }

            $records = $json['records'] ?? [];
            if (!is_array($records)) {
                continue;
            }

            foreach ($records as $recordEntry) {
                if (!is_array($recordEntry)) {
                    continue;
                }

                $value = $recordEntry['value'] ?? null;
                if (!is_array($value)) {
                    continue;
                }

                $items[] = [
                    'uri' => (string) ($recordEntry['uri'] ?? ''),
                    'cid' => (string) ($recordEntry['cid'] ?? ''),
                    'text' => (string) ($value['text'] ?? ''),
                    'createdAt' => (string) ($value['createdAt'] ?? ''),
                    'indexedAt' => '',
                    'author' => [
                        'did' => $repoDid,
                        'handle' => $repoDid,
                        'displayName' => $repoDid,
                        'avatar' => '',
                    ],
                ];
            }
        }

        usort($items, static function (array $a, array $b): int {
            $at = (string) ($a['createdAt'] ?? '');
            $bt = (string) ($b['createdAt'] ?? '');
            return strcmp($bt, $at);
        });

        if (count($items) > $limit) {
            $items = array_slice($items, 0, $limit);
        }

        return [
            'source' => 'atproto',
            'mode' => 'pds',
            'viewerDid' => $viewerDid,
            'cursor' => '',
            'items' => $items,
        ];
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
                    'source' => 'atproto',
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
                    'source' => 'atproto',
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
                    'source' => 'atproto',
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

    private function getAtprotoMode(): string
    {
        $mode = (string) Config::get('xavi_social.atproto.mode');
        if ($mode === '') {
            $env = getenv('XAVI_SOCIAL_ATPROTO_MODE');
            $mode = $env === false ? '' : (string) $env;
        }

        $mode = strtolower(trim($mode));
        if ($mode === 'appview') {
            return 'appview';
        }

        return 'pds';
    }

    /**
     * @return list<string>
     */
    private function getAtprotoPublicDids(): array
    {
        $raw = (string) Config::get('xavi_social.atproto.public_dids');
        if ($raw === '') {
            $env = getenv('XAVI_SOCIAL_ATPROTO_PUBLIC_DIDS');
            $raw = $env === false ? '' : (string) $env;
        }

        $raw = trim($raw);
        if ($raw === '') {
            return [];
        }

        $out = [];
        foreach (preg_split('/\s*,\s*/', $raw) as $part) {
            $part = trim((string) $part);
            if ($part !== '') {
                $out[] = $part;
            }
        }

        return $out;
    }

    /**
     * @return array<string,mixed>
     */
    private function mockTimeline(): array
    {
        $now = time();
        $posts = [];

        $posts[] = [
            'uri' => 'mock://post/1',
            'cid' => 'mockcid1',
            'text' => 'Welcome. Configure ATProto (XRPC host + credentials) to load the real timeline.',
            'createdAt' => date(DATE_ATOM, $now - 120),
            'indexedAt' => date(DATE_ATOM, $now - 120),
            'author' => [
                'did' => 'did:mock:system',
                'handle' => 'system',
                'displayName' => 'System',
                'avatar' => '',
            ],
        ];

        $user = $this->app->make(User::class);
        if ($user->isRegistered()) {
            $posts[] = [
                'uri' => 'mock://post/2',
                'cid' => 'mockcid2',
                'text' => 'You are logged into Concrete. Posting is enabled (once ATProto is configured).',
                'createdAt' => date(DATE_ATOM, $now - 60),
                'indexedAt' => date(DATE_ATOM, $now - 60),
                'author' => [
                    'did' => 'did:mock:you',
                    'handle' => (string) $user->getUserName(),
                    'displayName' => (string) $user->getUserName(),
                    'avatar' => '',
                ],
            ];
        }

        return [
            'source' => 'mock',
            'cursor' => '',
            'items' => $posts,
        ];
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
