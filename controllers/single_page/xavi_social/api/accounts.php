<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api;

use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;

final class Accounts extends PageController
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

        $userId = (int) $user->getUserID();

        try {
            $db = $this->app->make('database')->connection();
            $rows = $db->fetchAllAssociative(
                'SELECT id, did, handle, issuer, pdsUrl, appviewUrl, scopes, revoked, createdAt, updatedAt'
                . ' FROM XaviSocialAtprotoAccounts'
                . ' WHERE userId = ?'
                . ' ORDER BY id DESC',
                [$userId]
            );
        } catch (\Throwable $e) {
            $this->sendJson([
                'error' => 'db_not_ready',
                'message' => 'Linked accounts table is missing or unavailable. Run package upgrade to install db.xml.',
            ], 500);
        }

        $this->sendJson([
            'ok' => true,
            'authMethod' => $authMethod,
            'userId' => $userId,
            'accounts' => array_values($rows),
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
        $configSecret = (string) \Concrete\Core\Support\Facade\Config::get('xavi_social.jwt_secret');
        if ($configSecret !== '') {
            return $configSecret;
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
