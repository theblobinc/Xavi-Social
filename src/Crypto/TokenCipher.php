<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Crypto;

use Concrete\Core\Application\Application;

final class TokenCipher
{
    private Application $app;

    public function __construct(Application $app)
    {
        $this->app = $app;
    }

    /**
     * Encrypts a token for storage.
     *
     * Format: xv1:<base64url(nonce[12] || tag[16] || ciphertext)>
     */
    public function encrypt(string $plaintext): string
    {
        if ($plaintext === '') {
            return '';
        }

        $key = $this->getBinaryKey();
        $nonce = random_bytes(12);
        $tag = '';

        $ciphertext = openssl_encrypt(
            $plaintext,
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            $nonce,
            $tag
        );

        if ($ciphertext === false || $tag === '') {
            throw new \RuntimeException('Token encryption failed');
        }

        return 'xv1:' . $this->base64urlEncode($nonce . $tag . $ciphertext);
    }

    /**
     * Decrypts a token read from storage.
     *
     * Back-compat: if the value is not in xv1 format, treat it as plaintext.
     */
    public function decrypt(string $stored): string
    {
        $stored = (string) $stored;
        if ($stored === '') {
            return '';
        }

        if (!str_starts_with($stored, 'xv1:')) {
            return $stored;
        }

        $payload = substr($stored, 4);
        $raw = $this->base64urlDecode($payload);
        if ($raw === null || strlen($raw) < (12 + 16 + 1)) {
            throw new \RuntimeException('Token decrypt payload invalid');
        }

        $nonce = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ciphertext = substr($raw, 28);

        $key = $this->getBinaryKey();

        $plaintext = openssl_decrypt(
            $ciphertext,
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            $nonce,
            $tag
        );

        if ($plaintext === false) {
            throw new \RuntimeException('Token decryption failed');
        }

        return $plaintext;
    }

    private function getBinaryKey(): string
    {
        $config = $this->app->make('config');
        $keyMaterial = (string) $config->get('concrete.security.token.encryption');
        if ($keyMaterial === '') {
            $keyMaterial = (string) getenv('XAVI_SOCIAL_TOKEN_KEY');
        }
        if ($keyMaterial === '') {
            throw new \RuntimeException('Missing encryption key material (concrete.security.token.encryption or XAVI_SOCIAL_TOKEN_KEY)');
        }

        return hash('sha256', $keyMaterial, true);
    }

    private function base64urlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function base64urlDecode(string $b64url): ?string
    {
        $b64 = strtr($b64url, '-_', '+/');
        $pad = strlen($b64) % 4;
        if ($pad !== 0) {
            $b64 .= str_repeat('=', 4 - $pad);
        }

        $raw = base64_decode($b64, true);
        return $raw === false ? null : $raw;
    }
}
