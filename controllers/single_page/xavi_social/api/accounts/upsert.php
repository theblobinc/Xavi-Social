<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api\Accounts;

use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\User\User;
use Concrete\Package\XaviSocial\Crypto\TokenCipher;
use Symfony\Component\HttpFoundation\JsonResponse;

class Upsert extends PageController
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
                'message' => 'Concrete login (cookie) or Bearer JWT required.',
            ], 401);
        }

        $raw = (string) $this->request->getContent();
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            $this->sendJson([
                'error' => 'bad_request',
                'message' => 'Expected JSON body.',
            ], 400);
        }

        $did = trim((string) ($json['did'] ?? ''));
        if ($did === '') {
            $this->sendJson([
                'error' => 'bad_request',
                'message' => 'Missing did.',
            ], 400);
        }

        $handle = trim((string) ($json['handle'] ?? ''));
        $issuer = trim((string) ($json['issuer'] ?? ''));
        $pdsUrl = trim((string) ($json['pdsUrl'] ?? ''));
        $appviewUrl = trim((string) ($json['appviewUrl'] ?? ''));
        $scopes = (string) ($json['scopes'] ?? '');

        $refreshToken = (string) ($json['refreshToken'] ?? '');
        $accessToken = (string) ($json['accessToken'] ?? '');
        $accessTokenExpiresAt = (int) ($json['accessTokenExpiresAt'] ?? 0);

        $userId = (int) $user->getUserID();
        $now = time();

        try {
            $db = $this->app->make('database')->connection();
        } catch (\Throwable $e) {
            $this->sendJson([
                'error' => 'db_not_ready',
                'message' => 'Database connection unavailable.',
            ], 500);
        }

        $cipher = new TokenCipher($this->app);

        $refreshEnc = $refreshToken !== '' ? (string) $cipher->encrypt($refreshToken) : '';
        $accessEnc = $accessToken !== '' ? (string) $cipher->encrypt($accessToken) : '';

        try {
            $existing = $db->fetchAssociative(
                'SELECT id FROM XaviSocialAtprotoAccounts WHERE userId = ? AND did = ? LIMIT 1',
                [$userId, $did]
            );

            if (is_array($existing) && isset($existing['id'])) {
                $id = (int) $existing['id'];

                $update = [
                    'handle' => $handle,
                    'issuer' => $issuer,
                    'pdsUrl' => $pdsUrl,
                    'appviewUrl' => $appviewUrl,
                    'scopes' => $scopes,
                    'updatedAt' => $now,
                    'revoked' => 0,
                ];

                if ($refreshEnc !== '') {
                    $update['refreshToken'] = $refreshEnc;
                }
                if ($accessEnc !== '') {
                    $update['accessToken'] = $accessEnc;
                    $update['accessTokenExpiresAt'] = $accessTokenExpiresAt;
                }

                $db->update('XaviSocialAtprotoAccounts', $update, ['id' => $id]);

                $this->sendJson([
                    'ok' => true,
                    'authMethod' => $authMethod,
                    'userId' => $userId,
                    'accountId' => $id,
                    'did' => $did,
                    'handle' => $handle,
                ]);
            }

            $insert = [
                'userId' => $userId,
                'did' => $did,
                'handle' => $handle,
                'issuer' => $issuer,
                'pdsUrl' => $pdsUrl,
                'appviewUrl' => $appviewUrl,
                'scopes' => $scopes,
                'refreshToken' => $refreshEnc,
                'accessToken' => $accessEnc,
                'accessTokenExpiresAt' => $accessTokenExpiresAt,
                'revoked' => 0,
                'createdAt' => $now,
                'updatedAt' => $now,
            ];

            $db->insert('XaviSocialAtprotoAccounts', $insert);
            $id = (int) $db->lastInsertId();

            $this->sendJson([
                'ok' => true,
                'authMethod' => $authMethod,
                'userId' => $userId,
                'accountId' => $id,
                'did' => $did,
                'handle' => $handle,
            ]);
        } catch (\Throwable $e) {
            $this->sendJson([
                'error' => 'db_error',
                'message' => 'Failed to store linked account.',
            ], 500);
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
        $env = getenv('XAVI_SOCIAL_JWT_SECRET');
        if ($env !== false && (string) $env !== '') {
            return (string) $env;
        }

        return (string) \Concrete\Core\Support\Facade\Config::get('xavi_social.jwt_secret');
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
