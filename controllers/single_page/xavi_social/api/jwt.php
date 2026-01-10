<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api;

use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Support\Facade\Config;
use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;

class Jwt extends PageController
{
    public function view(): void
    {
        $user = $this->app->make(User::class);
        if (!$user->isRegistered()) {
            $this->sendJson(
                [
                    'error' => 'not_authenticated',
                    'message' => 'Concrete session required to issue a JWT.',
                ],
                401
            );
        }

        $secret = $this->getJwtSecret();
        if ($secret === '') {
            $this->sendJson(
                [
                    'error' => 'jwt_not_configured',
                    'message' => 'Set xavi_social.jwt_secret config value or XAVI_SOCIAL_JWT_SECRET env var.',
                ],
                500
            );
        }

        $now = time();
        $exp = $now + 60 * 60;

        $payload = [
            'iss' => (string) ($this->request->getSchemeAndHttpHost() ?? ''),
            'sub' => (int) $user->getUserID(),
            'name' => (string) $user->getUserName(),
            'iat' => $now,
            'exp' => $exp,
        ];

        $token = $this->jwtEncodeHs256($payload, $secret);

        $this->sendJson([
            'token' => $token,
            'tokenType' => 'Bearer',
            'expiresAt' => $exp,
            'userId' => (int) $user->getUserID(),
            'userName' => (string) $user->getUserName(),
        ]);
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

    private function jwtEncodeHs256(array $payload, string $secret): string
    {
        $header = ['typ' => 'JWT', 'alg' => 'HS256'];
        $header64 = $this->base64UrlEncode((string) json_encode($header, JSON_UNESCAPED_SLASHES));
        $payload64 = $this->base64UrlEncode((string) json_encode($payload, JSON_UNESCAPED_SLASHES));
        $toSign = $header64 . '.' . $payload64;
        $sig = hash_hmac('sha256', $toSign, $secret, true);
        $sig64 = $this->base64UrlEncode($sig);
        return $toSign . '.' . $sig64;
    }

    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
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
