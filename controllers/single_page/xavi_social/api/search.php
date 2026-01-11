<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api;

use Concrete\Core\Http\Request;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Support\Facade\Config;
use Concrete\Core\User\User;
use Concrete\Package\XaviSocial\Crypto\TokenCipher;
use Concrete\Package\XaviSocial\Atproto\LocalPdsProvisioner;
use Concrete\Package\XaviSocial\Storage\Postgres;
use GuzzleHttp\Client;
use Symfony\Component\HttpFoundation\JsonResponse;

class Search extends PageController
{
    public function view(): void
    {
        // Avoid holding the PHP session lock during potentially slow network / DB work.
        if (function_exists('session_status') && session_status() === PHP_SESSION_ACTIVE) {
            @session_write_close();
        }

        $q = trim((string) $this->request->query->get('q', ''));
        $limit = (int) $this->request->query->get('limit', 30);
        if ($limit <= 0) {
            $limit = 30;
        }
        if ($limit > 100) {
            $limit = 100;
        }

        if ($q === '') {
            $this->sendJson([
                'ok' => true,
                'q' => $q,
                'items' => [],
                'sources' => ['local' => 0, 'appview' => 0],
            ]);
        }

        // Search whatever we can from the current Concrete user's linked accounts.
        // Note: ATProto doesn't offer a "search everything" endpoint on PDS; the best we can do here
        // without an AppView is to search each linked account's own repo posts.
        [$accountItems, $accountCounts] = $this->searchAllUserAccounts($q, $limit);
        $appviewItems = $this->searchAppview($q, $limit);

        $cachedItems = $this->searchCachedPublicPosts($q, $limit);

        // Keep more candidates while merging multiple sources, then slice to requested limit.
        $candidateLimit = $limit * 3;
        if ($candidateLimit < $limit) {
            $candidateLimit = $limit;
        }
        if ($candidateLimit > 300) {
            $candidateLimit = 300;
        }

        $merged = $this->mergeAndSortItems($appviewItems, $accountItems, $candidateLimit);
        $merged = $this->mergeAndSortItems($merged, $cachedItems, $limit);

        $this->sendJson([
            'ok' => true,
            'q' => $q,
            'limit' => $limit,
            'items' => $merged,
            'sources' => [
                'accounts' => $accountCounts,
                'appview' => count($appviewItems),
                'cached' => count($cachedItems),
            ],
        ]);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function searchCachedPublicPosts(string $q, int $limit): array
    {
        $q = trim($q);
        if ($q === '') {
            return [];
        }

        $pdo = Postgres::connect();
        if (!$pdo) {
            return [];
        }

        try {
            Postgres::ensureSchema($pdo);
        } catch (\Throwable $e) {
            return [];
        }

        if ($limit <= 0) {
            $limit = 30;
        }
        if ($limit > 100) {
            $limit = 100;
        }

        $pattern = '%' . $q . '%';

        try {
            $stmt = $pdo->prepare(
                "SELECT raw\n" .
                "FROM xavi_social_cached_posts\n" .
                "WHERE audience = 'public'\n" .
                "  AND text ILIKE :pattern\n" .
                "ORDER BY updated_at DESC\n" .
                "LIMIT :limit"
            );
            $stmt->bindValue('pattern', $pattern, \PDO::PARAM_STR);
            $stmt->bindValue('limit', $limit, \PDO::PARAM_INT);
            $stmt->execute();
            $rows = $stmt->fetchAll();
        } catch (\Throwable $e) {
            return [];
        }

        if (!is_array($rows)) {
            return [];
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

        return $out;
    }

    /**
     * Search across all linked accounts for the logged-in Concrete user.
     *
     * @return array{0: array<int,array<string,mixed>>, 1: array<int,array<string,mixed>>}
     */
    private function searchAllUserAccounts(string $q, int $limit): array
    {
        $cookieUser = $this->app->make(User::class);
        if (!$cookieUser || !$cookieUser->isRegistered()) {
            return [[], []];
        }

        $userId = (int) $cookieUser->getUserID();

        $accounts = $this->getAllAccountRowsForUserId($userId);

        // Ensure the local PDS account exists; it may not yet be in the table.
        if (empty($accounts)) {
            try {
                $provisioner = new LocalPdsProvisioner($this->app);
                $provisioner->ensureLocalAccountForUserId($userId);
                $accounts = $this->getAllAccountRowsForUserId($userId);
            } catch (\Throwable $e) {
                // ignore
            }
        }

        $needle = strtolower($q);
        $allItems = [];
        $counts = [];

        $cipher = new TokenCipher($this->app);

        foreach ($accounts as $row) {
            if (!is_array($row)) {
                continue;
            }

            $accountId = (int) ($row['id'] ?? 0);
            $did = trim((string) ($row['did'] ?? ''));
            $handle = trim((string) ($row['handle'] ?? ''));
            $issuer = trim((string) ($row['issuer'] ?? ''));
            $pdsUrl = trim((string) ($row['pdsUrl'] ?? ''));

            if ($did === '' || $accountId <= 0) {
                continue;
            }

            if ($pdsUrl === '') {
                $pdsUrl = $this->getDefaultPdsOrigin();
            }
            $pdsHttp = $this->normalizeOriginForServerCalls($pdsUrl);

            $accessJwt = '';
            $refreshJwt = '';
            try {
                $accessJwt = (string) $cipher->decrypt((string) ($row['accessToken'] ?? ''));
                $refreshJwt = (string) $cipher->decrypt((string) ($row['refreshToken'] ?? ''));
            } catch (\Throwable $e) {
                $accessJwt = '';
                $refreshJwt = '';
            }

            if ($accessJwt === '') {
                $counts[] = [
                    'id' => $accountId,
                    'did' => $did,
                    'handle' => $handle,
                    'issuer' => $issuer,
                    'count' => 0,
                    'note' => 'missing_tokens',
                ];
                continue;
            }

            // Pull a larger sample then filter locally.
            $out = $this->listRecordsWithJwt($pdsHttp, $accessJwt, $did, 100);
            if (($out['status'] ?? 0) === 401 || ($out['status'] ?? 0) === 403) {
                if ($refreshJwt !== '') {
                    try {
                        [$newAccess, $newRefresh] = $this->refreshLocalSession($pdsHttp, $refreshJwt);
                        $this->storeTokensForAccountId($accountId, $newAccess, $newRefresh);
                        $out = $this->listRecordsWithJwt($pdsHttp, $newAccess, $did, 100);
                    } catch (\Throwable $e) {
                        // ignore
                    }
                }
            }

            if (($out['ok'] ?? false) !== true) {
                $counts[] = [
                    'id' => $accountId,
                    'did' => $did,
                    'handle' => $handle,
                    'issuer' => $issuer,
                    'count' => 0,
                    'note' => 'list_failed',
                ];
                continue;
            }

            $items = $out['items'] ?? [];
            if (!is_array($items)) {
                $items = [];
            }

            $filtered = [];
            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $text = (string) ($item['text'] ?? '');
                if ($text === '') {
                    continue;
                }
                if (strpos(strtolower($text), $needle) === false) {
                    continue;
                }

                // Prefer handle/displayName for nicer UI.
                if (!isset($item['author']) || !is_array($item['author'])) {
                    $item['author'] = [];
                }
                $item['author']['did'] = $did;
                $item['author']['handle'] = $handle !== '' ? $handle : $did;
                $item['author']['displayName'] = $handle !== '' ? $handle : $did;

                // Light metadata so UI can tell where the hit came from.
                $item['_xaviAccount'] = [
                    'id' => $accountId,
                    'did' => $did,
                    'handle' => $handle,
                    'issuer' => $issuer,
                ];

                $filtered[] = $item;
                if (count($filtered) >= $limit) {
                    break;
                }
            }

            foreach ($filtered as $it) {
                $allItems[] = $it;
            }

            $counts[] = [
                'id' => $accountId,
                'did' => $did,
                'handle' => $handle,
                'issuer' => $issuer,
                'count' => count($filtered),
            ];
        }

        return [$allItems, $counts];
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function searchAppview(string $q, int $limit): array
    {
        $xrpcHost = $this->getAtprotoXrpcHost();
        $identifier = $this->getAtprotoIdentifier();
        $password = $this->getAtprotoPassword();

        if ($xrpcHost === '' || $identifier === '' || $password === '') {
            return [];
        }

        try {
            [$accessJwt] = $this->createSession($xrpcHost, $identifier, $password);
        } catch (\Throwable $e) {
            return [];
        }

        $client = $this->makeHttpClient();

        try {
            $resp = $client->get(rtrim($xrpcHost, '/') . '/xrpc/app.bsky.feed.searchPosts', [
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Bearer ' . $accessJwt,
                ],
                'query' => [
                    'q' => $q,
                    'limit' => $limit,
                ],
            ]);
        } catch (\Throwable $e) {
            return [];
        }

        $status = $resp->getStatusCode();
        $body = (string) $resp->getBody();
        $json = json_decode($body, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            return [];
        }

        $posts = $json['posts'] ?? [];
        if (!is_array($posts)) {
            $posts = [];
        }

        $items = [];
        foreach ($posts as $post) {
            if (!is_array($post)) {
                continue;
            }

            $record = $post['record'] ?? null;
            if (!is_array($record)) {
                $record = [];
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

        return $items;
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

        if (count($out) > $limit) {
            $out = array_slice($out, 0, $limit);
        }

        return $out;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function getAllAccountRowsForUserId(int $userId): array
    {
        try {
            $db = $this->app->make('database')->connection();
        } catch (\Throwable $e) {
            return [];
        }

        try {
            $rows = $db->fetchAllAssociative(
                'SELECT * FROM XaviSocialAtprotoAccounts WHERE userId = ? AND revoked = 0 ORDER BY id DESC',
                [$userId]
            );
            return is_array($rows) ? $rows : [];
        } catch (\Throwable $e) {
            return [];
        }
    }

    /**
     * @return array<string,mixed>|null
     */
    // Legacy helper removed: search now considers all account rows for the user.

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
    private function createSession(string $xrpcHost, string $identifier, string $password): array
    {
        $client = $this->makeHttpClient();

        $resp = $client->post(rtrim($xrpcHost, '/') . '/xrpc/com.atproto.server.createSession', [
            'headers' => ['Accept' => 'application/json', 'Content-Type' => 'application/json'],
            'body' => (string) json_encode(['identifier' => $identifier, 'password' => $password], JSON_UNESCAPED_SLASHES),
        ]);

        $status = $resp->getStatusCode();
        $body = (string) $resp->getBody();
        $json = json_decode($body, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            throw new \RuntimeException('createSession failed');
        }

        $accessJwt = trim((string) ($json['accessJwt'] ?? ''));
        $did = trim((string) ($json['did'] ?? ''));

        if ($accessJwt === '') {
            throw new \RuntimeException('createSession missing accessJwt');
        }

        return [$accessJwt, $did];
    }

    private function getAtprotoXrpcHost(): string
    {
        $env = getenv('XAVI_SOCIAL_ATPROTO_XRPC_HOST');
        $host = $env === false ? '' : trim((string) $env);
        $host = rtrim($host, '/');
        return $host;
    }

    private function getAtprotoIdentifier(): string
    {
        $env = getenv('XAVI_SOCIAL_ATPROTO_IDENTIFIER');
        return $env === false ? '' : trim((string) $env);
    }

    private function getAtprotoPassword(): string
    {
        $env = getenv('XAVI_SOCIAL_ATPROTO_PASSWORD');
        return $env === false ? '' : trim((string) $env);
    }

    private function makeHttpClient(): Client
    {
        return new Client([
            'timeout' => 12,
            'http_errors' => false,
        ]);
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

    private function storeTokensForAccountId(int $accountId, string $accessJwt, string $refreshJwt): void
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
