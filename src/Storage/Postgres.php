<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Storage;

use Concrete\Core\Support\Facade\Config;

final class Postgres
{
    /**
     * Returns a configured PDO connection to Postgres, or null if not configured.
     */
    public static function connect(): ?\PDO
    {
        $dsn = self::getDsn();
        if ($dsn === '') {
            return null;
        }

        $user = (string) (getenv('XAVI_SOCIAL_PG_USER') ?: Config::get('xavi_social.pg.user', ''));
        $pass = (string) (getenv('XAVI_SOCIAL_PG_PASSWORD') ?: Config::get('xavi_social.pg.password', ''));

        try {
            $pdo = new \PDO($dsn, $user !== '' ? $user : null, $pass !== '' ? $pass : null, [
                \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            ]);
        } catch (\Throwable $e) {
            return null;
        }

        return $pdo;
    }

    public static function ensureSchema(\PDO $pdo): void
    {
        // Posts cached/ingested from linked identities.
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS xavi_social_cached_posts (\n" .
            "  id bigserial PRIMARY KEY,\n" .
            "  owner_user_id integer NOT NULL DEFAULT 0,\n" .
            "  source_account_id integer NOT NULL DEFAULT 0,\n" .
            "  origin text NOT NULL DEFAULT 'atproto',\n" .
            "  uri text NOT NULL UNIQUE,\n" .
            "  cid text NULL,\n" .
            "  author_did text NULL,\n" .
            "  author_handle text NULL,\n" .
            "  text text NULL,\n" .
            "  created_at_iso text NULL,\n" .
            "  indexed_at_iso text NULL,\n" .
            "  audience text NOT NULL DEFAULT 'public',\n" .
            "  requires_auth_to_interact boolean NOT NULL DEFAULT false,\n" .
            "  raw jsonb NULL,\n" .
            "  created_at timestamptz NOT NULL DEFAULT now(),\n" .
            "  updated_at timestamptz NOT NULL DEFAULT now()\n" .
            ");"
        );

        // Privacy/audience settings for posts (extensible Facebook-like model).
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS xavi_social_post_audience (\n" .
            "  id bigserial PRIMARY KEY,\n" .
            "  owner_user_id integer NOT NULL,\n" .
            "  uri text NOT NULL,\n" .
            "  audience text NOT NULL DEFAULT 'public',\n" .
            "  rules jsonb NULL,\n" .
            "  created_at timestamptz NOT NULL DEFAULT now(),\n" .
            "  updated_at timestamptz NOT NULL DEFAULT now(),\n" .
            "  UNIQUE(owner_user_id, uri)\n" .
            ");"
        );

        // Emoji reactions (unicode emoji strings).
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS xavi_social_reactions (\n" .
            "  id bigserial PRIMARY KEY,\n" .
            "  post_uri text NOT NULL,\n" .
            "  reactor_user_id integer NOT NULL,\n" .
            "  emoji text NOT NULL,\n" .
            "  created_at timestamptz NOT NULL DEFAULT now(),\n" .
            "  updated_at timestamptz NOT NULL DEFAULT now(),\n" .
            "  UNIQUE(post_uri, reactor_user_id, emoji)\n" .
            ");"
        );

        $pdo->exec("CREATE INDEX IF NOT EXISTS xavi_social_cached_posts_owner_idx ON xavi_social_cached_posts(owner_user_id);");
        $pdo->exec("CREATE INDEX IF NOT EXISTS xavi_social_cached_posts_audience_idx ON xavi_social_cached_posts(audience);");
        $pdo->exec("CREATE INDEX IF NOT EXISTS xavi_social_cached_posts_audience_updated_uri_idx ON xavi_social_cached_posts(audience, updated_at DESC, uri DESC);");
        $pdo->exec("CREATE INDEX IF NOT EXISTS xavi_social_reactions_post_idx ON xavi_social_reactions(post_uri);");
    }

    private static function getDsn(): string
    {
        $dsn = (string) (getenv('XAVI_SOCIAL_PG_DSN') ?: Config::get('xavi_social.pg.dsn', ''));
        if ($dsn !== '') {
            return $dsn;
        }

        $host = (string) (getenv('XAVI_SOCIAL_PG_HOST') ?: Config::get('xavi_social.pg.host', ''));
        $port = (string) (getenv('XAVI_SOCIAL_PG_PORT') ?: Config::get('xavi_social.pg.port', '5432'));
        $db = (string) (getenv('XAVI_SOCIAL_PG_DB') ?: Config::get('xavi_social.pg.db', 'xavi_social'));

        if ($host === '') {
            // Best default: reach Postgres by Docker service name on a private network.
            // If the PHP container isn't attached to that network, override via env/config.
            $host = (string) (getenv('XAVI_SOCIAL_PG_HOST_FALLBACK') ?: 'postgres');
        }

        if ($host === '') {
            return '';
        }

        $port = $port !== '' ? $port : '5432';
        $db = $db !== '' ? $db : 'xavi_social';

        return sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port, $db);
    }
}
