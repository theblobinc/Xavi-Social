<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api\Cache;

use Concrete\Core\Support\Facade\Config;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\User\User;
use Concrete\Package\XaviSocial\Storage\Postgres;

class Upsert extends PageController
{
    public function view(): void
    {
        if (strtoupper((string) $this->request->getMethod()) !== 'POST') {
            $this->sendJson(['error' => 'method_not_allowed'], 405);
        }

        [$authMethod, $user] = $this->authenticate();
        if (!$user || !$user->isRegistered()) {
            $this->sendJson([
                'error' => 'not_authenticated',
                'message' => 'Concrete login (cookie) or Bearer JWT required.',
            ], 401);
        }

        $userId = (int) $user->getUserID();

        $raw = (string) $this->request->getContent();
        if ($raw === '') {
            $fallback = @file_get_contents('php://input');
            if ($fallback !== false && $fallback !== '') {
                $raw = (string) $fallback;
            }
        }

        $json = null;
        $trim = trim($raw);
        if ($trim !== '') {
            $json = json_decode($raw, true);
        }

        $items = [];
        if (is_array($json)) {
            if (isset($json['items']) && is_array($json['items'])) {
                $items = $json['items'];
            } elseif (isset($json['posts']) && is_array($json['posts'])) {
                $items = $json['posts'];
            } elseif (isset($json['data']) && is_array($json['data'])) {
                $items = $json['data'];
            } else {
                // If the request body itself is a list, accept it.
                $isList = array_keys($json) === range(0, count($json) - 1);
                if ($isList) {
                    $items = $json;
                }
            }
        }

        if (!is_array($items) || empty($items)) {
            $this->sendJson([
                'error' => 'bad_request',
                'message' => 'Expected JSON body with {"items": [...]} (or an array of items).',
            ], 400);
        }

        $pdo = Postgres::connect();
        if (!$pdo) {
            $this->sendJson([
                'error' => 'postgres_not_configured',
                'message' => 'Postgres is not configured/available for xavi_social caching.',
            ], 501);
        }

        Postgres::ensureSchema($pdo);

        $stmt = $pdo->prepare(
            "INSERT INTO xavi_social_cached_posts (\n" .
            "  owner_user_id, source_account_id, origin, uri, cid, author_did, author_handle, text, created_at_iso, indexed_at_iso, audience, requires_auth_to_interact, raw, updated_at\n" .
            ") VALUES (\n" .
            "  :owner_user_id, :source_account_id, :origin, :uri, :cid, :author_did, :author_handle, :text, :created_at_iso, :indexed_at_iso, :audience, :requires_auth_to_interact, :raw::jsonb, now()\n" .
            ") ON CONFLICT (uri) DO UPDATE SET\n" .
            "  owner_user_id = EXCLUDED.owner_user_id,\n" .
            "  source_account_id = EXCLUDED.source_account_id,\n" .
            "  origin = EXCLUDED.origin,\n" .
            "  cid = EXCLUDED.cid,\n" .
            "  author_did = EXCLUDED.author_did,\n" .
            "  author_handle = EXCLUDED.author_handle,\n" .
            "  text = EXCLUDED.text,\n" .
            "  created_at_iso = EXCLUDED.created_at_iso,\n" .
            "  indexed_at_iso = EXCLUDED.indexed_at_iso,\n" .
            "  audience = EXCLUDED.audience,\n" .
            "  requires_auth_to_interact = EXCLUDED.requires_auth_to_interact,\n" .
            "  raw = EXCLUDED.raw,\n" .
            "  updated_at = now()"
        );

        $processed = 0;
        $skipped = 0;

        foreach ($items as $item) {
            if (!is_array($item)) {
                $skipped++;
                continue;
            }

            $uri = trim((string) ($item['uri'] ?? ''));
            if ($uri === '') {
                $skipped++;
                continue;
            }

            $origin = trim((string) ($item['origin'] ?? 'atproto'));
            if ($origin === '') {
                $origin = 'atproto';
            }

            $audience = trim((string) ($item['audience'] ?? 'public'));
            if ($audience === '') {
                $audience = 'public';
            }

            $author = $item['author'] ?? null;
            if (!is_array($author)) {
                $author = [];
            }

            $rawJson = json_encode($item, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (!is_string($rawJson) || $rawJson === '') {
                $rawJson = '{}';
            }

            $requiresAuth = (bool) ($item['requiresAuthToInteract'] ?? false);

            $stmt->execute([
                'owner_user_id' => $userId,
                'source_account_id' => (int) ($item['_xaviAccount']['id'] ?? 0),
                'origin' => $origin,
                'uri' => $uri,
                'cid' => (string) ($item['cid'] ?? ''),
                'author_did' => (string) ($author['did'] ?? ''),
                'author_handle' => (string) ($author['handle'] ?? ''),
                'text' => (string) ($item['text'] ?? ''),
                'created_at_iso' => (string) ($item['createdAt'] ?? ''),
                'indexed_at_iso' => (string) ($item['indexedAt'] ?? ''),
                'audience' => $audience,
                'requires_auth_to_interact' => $requiresAuth ? 'true' : 'false',
                'raw' => $rawJson,
            ]);

            $processed++;
        }

        $this->sendJson([
            'ok' => true,
            'authMethod' => $authMethod,
            'processed' => $processed,
            'skipped' => $skipped,
        ]);
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
     * @param array<string,mixed> $payload
     */
    private function sendJson(array $payload, int $status = 200): void
    {
        $resp = new \Symfony\Component\HttpFoundation\JsonResponse($payload, $status);
        $resp->send();
        exit;
    }
}
