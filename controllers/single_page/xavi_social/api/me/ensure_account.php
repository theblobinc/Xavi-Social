<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api\Me;

use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Support\Facade\Config;
use Concrete\Core\User\User;
use Concrete\Package\XaviSocial\Atproto\LocalPdsProvisioner;
use Symfony\Component\HttpFoundation\JsonResponse;

final class EnsureAccount extends PageController
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

        try {
            $provisioner = new LocalPdsProvisioner($this->app);
            $result = $provisioner->ensureLocalAccountForUserId((int) $user->getUserID());

            $account = $result['account'] ?? [];
            if (!is_array($account)) {
                $account = [];
            }

            $this->sendJson([
                'ok' => true,
                'authMethod' => $authMethod,
                'userId' => (int) $user->getUserID(),
                'userName' => (string) $user->getUserName(),
                'created' => (bool) ($result['created'] ?? false),
                'account' => [
                    'id' => isset($account['id']) ? (int) $account['id'] : null,
                    'did' => (string) ($account['did'] ?? ''),
                    'handle' => (string) ($account['handle'] ?? ''),
                    'pdsUrl' => (string) ($account['pdsUrl'] ?? ''),
                ],
            ]);
        } catch (\Throwable $e) {
            $msg = $e->getMessage();
            if (stripos($msg, 'invite') !== false) {
                $this->sendJson([
                    'error' => 'invite_required',
                    'message' => 'PDS invite code required. Configure XAVI_SOCIAL_ATPROTO_INVITE_CODE (or xavi_social.atproto.invite_code).',
                ], 409);
            }

            $debug = (string) $this->request->query->get('debug', '') === '1';
            $isSuper = false;
            try {
                $isSuper = $user !== null && method_exists($user, 'isSuperUser') && (bool) $user->isSuperUser();
            } catch (\Throwable $ignored) {
                $isSuper = false;
            }

            if ($debug && $isSuper) {
                $this->sendJson([
                    'error' => 'provision_failed',
                    'message' => 'Failed to provision local PDS account.',
                    'debug' => [
                        'exception' => get_class($e),
                        'detail' => $e->getMessage(),
                    ],
                ], 502);
            }

            $this->sendJson([
                'error' => 'provision_failed',
                'message' => 'Failed to provision local PDS account.',
            ], 502);
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
