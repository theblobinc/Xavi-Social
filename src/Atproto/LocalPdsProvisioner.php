<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Atproto;

use Concrete\Core\Application\Application;
use Concrete\Core\Http\Request;
use Concrete\Core\Support\Facade\Config;
use Concrete\Core\User\UserInfoRepository;
use Concrete\Package\XaviSocial\Crypto\TokenCipher;
use GuzzleHttp\Client;

final class LocalPdsProvisioner
{
    private Application $app;

    public function __construct(Application $app)
    {
        $this->app = $app;
    }

    /**
     * @return array{created: bool, account: array<string,mixed>}
     */
    public function ensureLocalAccountForUserId(int $userId): array
    {
        if ($userId <= 0) {
            throw new \InvalidArgumentException('Invalid userId');
        }

        $publicOrigin = $this->getPublicOrigin();
        $httpOrigin = $this->normalizeOriginForServerCalls($publicOrigin);

        $db = $this->app->make('database')->connection();

        $existing = $db->fetchAssociative(
            "SELECT * FROM XaviSocialAtprotoAccounts\n" .
            "WHERE userId = ? AND revoked = 0\n" .
            "  AND (issuer IS NULL OR issuer = '')\n" .
            "ORDER BY id DESC\n" .
            "LIMIT 1",
            [$userId]
        );

        if (is_array($existing) && isset($existing['did']) && trim((string) $existing['did']) !== '') {
            return ['created' => false, 'account' => $existing];
        }

        $server = $this->describeServer($httpOrigin);
        $domainSuffix = $this->pickUserDomainSuffix($server, $publicOrigin);

        $uiRepo = $this->app->make(UserInfoRepository::class);
        $ui = $uiRepo->getByID($userId);
        if ($ui === null) {
            throw new \RuntimeException('User not found');
        }

        $userName = (string) $ui->getUserName();
        $uiEmail = (string) $ui->getUserEmail();
        $host = (string) parse_url($publicOrigin, PHP_URL_HOST);

        $emailDomain = ($host !== '' && str_contains($host, '.')) ? $host : 'example.com';
        $randomEmail = 'user' . $userId . '-' . substr(bin2hex(random_bytes(4)), 0, 8) . '@' . $emailDomain;
        $emailCandidates = array_values(array_unique(array_filter([
            $uiEmail,
            $randomEmail,
        ], static fn ($v) => is_string($v) && trim($v) !== '')));

        $localPart = $this->normalizeHandleLocalPart($userName);
        if ($localPart === '') {
            $localPart = 'user' . $userId;
        }

        $password = $this->randomToken(32);
        $inviteCode = $this->getInviteCode();

        $handleCandidates = [
            $localPart . $domainSuffix,
            // Deterministic fallback for collisions.
            $localPart . '-' . $userId . $domainSuffix,
        ];

        // Randomized fallbacks for stubborn collisions or reserved handles.
        for ($i = 0; $i < 5; $i++) {
            $handleCandidates[] = $localPart . '-' . $userId . '-' . substr(bin2hex(random_bytes(4)), 0, 8) . $domainSuffix;
        }

        $handleCandidates = array_values(array_unique($handleCandidates));

        $handle = $handleCandidates[0];
        $create = null;
        $lastHandleIssue = '';

        foreach ($emailCandidates as $email) {
            foreach ($handleCandidates as $candidate) {
                try {
                    $handle = $candidate;
                    $create = $this->tryCreateAccount($httpOrigin, $handle, $email, $password, $inviteCode);
                    if (is_array($create)) {
                        break 2;
                    }
                } catch (\RuntimeException $e) {
                    $m = strtolower($e->getMessage());

                    if ($e->getCode() === 409) {
                        $lastHandleIssue = $e->getMessage();
                        continue;
                    }

                    if (str_contains($m, 'email')) {
                        // Try the next email candidate.
                        continue 2;
                    }

                    throw $e;
                }
            }
        }

        if (!is_array($create)) {
            $reason = $lastHandleIssue !== '' ? (': ' . $lastHandleIssue) : '';
            throw new \RuntimeException('Failed to create PDS account (handle unavailable)' . $reason);
        }

        $did = trim((string) ($create['did'] ?? ''));
        $createdHandle = trim((string) ($create['handle'] ?? $handle));
        $accessJwt = trim((string) ($create['accessJwt'] ?? ''));
        $refreshJwt = trim((string) ($create['refreshJwt'] ?? ''));

        if ($did === '' || $accessJwt === '' || $refreshJwt === '') {
            throw new \RuntimeException('PDS createAccount response missing did/accessJwt/refreshJwt');
        }

        $cipher = new TokenCipher($this->app);
        $accessEnc = (string) $cipher->encrypt($accessJwt);
        $refreshEnc = (string) $cipher->encrypt($refreshJwt);

        $now = time();
        $insert = [
            'userId' => $userId,
            'did' => $did,
            'handle' => $createdHandle,
            'issuer' => '',
            'pdsUrl' => $publicOrigin,
            'appviewUrl' => '',
            'scopes' => '',
            'refreshToken' => $refreshEnc,
            'accessToken' => $accessEnc,
            'accessTokenExpiresAt' => 0,
            'revoked' => 0,
            'createdAt' => $now,
            'updatedAt' => $now,
        ];

        $db->insert('XaviSocialAtprotoAccounts', $insert);
        $id = (int) $db->lastInsertId();

        $insert['id'] = $id;

        return ['created' => true, 'account' => $insert];
    }

    /**
     * @return array<string,mixed>
     */
    public function describeServer(string $origin): array
    {
        $client = $this->makeHttpClient();
        $resp = $client->get(rtrim($origin, '/') . '/xrpc/com.atproto.server.describeServer', [
            'headers' => ['Accept' => 'application/json'],
        ]);

        $status = $resp->getStatusCode();
        $body = (string) $resp->getBody();
        $json = json_decode($body, true);

        if ($status < 200 || $status >= 300 || !is_array($json)) {
            throw new \RuntimeException('describeServer failed');
        }

        return $json;
    }

    private function tryCreateAccount(string $origin, string $handle, string $email, string $password, string $inviteCode): ?array
    {
        $body = [
            'handle' => $handle,
            'email' => $email,
            'password' => $password,
        ];

        if ($inviteCode !== '') {
            $body['inviteCode'] = $inviteCode;
        }

        $client = $this->makeHttpClient();
        $resp = $client->post(rtrim($origin, '/') . '/xrpc/com.atproto.server.createAccount', [
            'headers' => [
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
            ],
            'body' => (string) json_encode($body, JSON_UNESCAPED_SLASHES),
        ]);

        $status = $resp->getStatusCode();
        $raw = (string) $resp->getBody();
        $json = json_decode($raw, true);

        if ($status >= 200 && $status < 300 && is_array($json)) {
            return $json;
        }

        // Common failure: handle taken. We allow one retry.
        if (is_array($json)) {
            $err = strtolower((string) ($json['error'] ?? ''));
            $msg = strtolower((string) ($json['message'] ?? ''));
            if (str_contains($err, 'handle') || str_contains($msg, 'handle')) {
                throw new \RuntimeException('Handle unavailable: ' . trim($err . ' ' . $msg), 409);
            }
            if (str_contains($err, 'invite') || str_contains($msg, 'invite')) {
                throw new \RuntimeException('Invite code required/invalid');
            }
        }

        $details = '';
        if (is_array($json)) {
            $err = trim((string) ($json['error'] ?? ''));
            $msg = trim((string) ($json['message'] ?? ''));
            if ($err !== '' || $msg !== '') {
                $details = ': ' . trim($err . ' ' . $msg);
            }
        }

        throw new \RuntimeException('createAccount failed (HTTP ' . $status . ')' . $details);
    }

    private function pickUserDomainSuffix(array $describeServer, string $origin): string
    {
        $domains = $describeServer['availableUserDomains'] ?? null;
        if (is_array($domains) && isset($domains[0]) && is_string($domains[0])) {
            $d = trim($domains[0]);
            if ($d !== '') {
                return $d[0] === '.' ? $d : '.' . $d;
            }
        }

        $host = (string) parse_url($origin, PHP_URL_HOST);
        if ($host !== '') {
            return '.' . $host;
        }

        return '.localhost';
    }

    private function normalizeHandleLocalPart(string $value): string
    {
        $v = strtolower(trim($value));
        $v = preg_replace('/[^a-z0-9-]+/', '-', $v) ?? '';
        $v = trim($v, '-');
        if (strlen($v) > 50) {
            $v = substr($v, 0, 50);
            $v = rtrim($v, '-');
        }
        return $v;
    }

    private function getInviteCode(): string
    {
        $code = (string) Config::get('xavi_social.atproto.invite_code');
        if ($code === '') {
            $env = getenv('XAVI_SOCIAL_ATPROTO_INVITE_CODE');
            $code = $env === false ? '' : (string) $env;
        }
        return trim($code);
    }

    private function getPublicOrigin(): string
    {
        $req = Request::getInstance();
        $reqOrigin = rtrim($req->getSchemeAndHttpHost(), '/');

        if ($this->isValidOrigin($reqOrigin)) {
            return $reqOrigin;
        }

        $origin = (string) Config::get('site.sites.default.seo.canonical_url');
        if ($this->isValidOrigin($origin)) {
            return rtrim((string) $origin, '/');
        }

        $envOrigin = getenv('PUBLIC_BASE_URL');
        if ($envOrigin !== false && $this->isValidOrigin((string) $envOrigin)) {
            return rtrim((string) $envOrigin, '/');
        }

        return $this->isValidOrigin($reqOrigin) ? $reqOrigin : '';
    }

    private function isValidOrigin(string $origin): bool
    {
        $origin = trim($origin);
        if ($origin === '') {
            return false;
        }

        // Concrete CLI can yield 'http://:' in some contexts.
        $host = (string) parse_url($origin, PHP_URL_HOST);
        $host = trim($host);
        if ($host === '' || $host === 'localhost') {
            return false;
        }

        return true;
    }

    private function normalizeOriginForServerCalls(string $publicOrigin): string
    {
        // In this repo, PHP runs inside Docker and nginx reverse-proxies the local PDS at /xrpc.
        // Using the public https origin from inside the container can fail (missing CA certs) and is
        // unnecessary; always prefer the internal nginx service for server-to-server calls.
        if ($this->isDockerRuntime()) {
            $override = getenv('XAVI_SOCIAL_INTERNAL_HTTP_ORIGIN');
            if ($override !== false && trim((string) $override) !== '') {
                return rtrim(trim((string) $override), '/');
            }

            // NOTE: Do not use http://nginx here; this repo uses an external shared Docker network
            // and multiple stacks may publish the hostname "nginx", causing nondeterministic DNS.
            return 'http://princegeorge-app-nginx';
        }

        $host = (string) parse_url($publicOrigin, PHP_URL_HOST);
        $host = strtolower(trim($host));

        if ($host === 'localhost' || $host === '127.0.0.1' || $host === '0.0.0.0') {
            return 'http://princegeorge-app-nginx';
        }

        return rtrim($publicOrigin, '/');
    }

    private function isDockerRuntime(): bool
    {
        // Standard marker created by Docker.
        if (is_file('/.dockerenv')) {
            return true;
        }

        // Fallback heuristic for our compose environment.
        return (string) getenv('DB_HOST') === 'mariadb';
    }

    private function randomToken(int $bytes): string
    {
        $raw = random_bytes($bytes);
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function makeHttpClient(): Client
    {
        return new Client([
            'timeout' => 15,
            'connect_timeout' => 5,
            'http_errors' => false,
        ]);
    }
}
