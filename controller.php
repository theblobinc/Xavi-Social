<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial;

use Concrete\Core\Entity\Package as PackageEntity;
use Concrete\Core\Page\Single as SinglePage;
use Concrete\Core\Page\Page;
use Concrete\Core\Package\Package;
use Concrete\Core\Support\Facade\Events;
use Concrete\Core\Support\Facade\Log;
use Concrete\Core\Support\Facade\Route;
use Concrete\Core\User\User;
use Concrete\Package\XaviSocial\Atproto\LocalPdsProvisioner;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

final class Controller extends Package
{
    protected $pkgHandle = 'xavi_social';
    protected $appVersionRequired = '9.0.0';
    protected $pkgVersion = '0.1.8';

    /**
     * Concrete v9+ default package autoloading expects classes under src/Concrete/...
     * This package keeps its classes directly under src/, so we register that mapping.
     *
     * @var array<string,string>
     */
    protected $pkgAutoloaderRegistries = [
        'src' => 'Concrete\\Package\\XaviSocial',
    ];

    public function getPackageName(): string
    {
        return t('Xavi Social');
    }

    public function getPackageDescription(): string
    {
        return t('ConcreteCMS v9 SPA shell for Xavi Social.');
    }

    public function install(): void
    {
        $pkg = parent::install();

        $this->installContentFile('db.xml');

        $this->installOrUpdateSinglePages($pkg);
    }

    public function upgrade(): void
    {
        parent::upgrade();
        $pkg = $this;

        $this->installContentFile('db.xml');
        $this->installOrUpdateSinglePages($pkg);
    }

    public function on_start(): void
    {
        $app = $this->app;

        $listener = static function ($event) use ($app): void {
            $userId = 0;

            if (is_object($event)) {
                if (method_exists($event, 'getUserInfo')) {
                    $ui = $event->getUserInfo();
                    if (is_object($ui) && method_exists($ui, 'getUserID')) {
                        $userId = (int) $ui->getUserID();
                    }
                } elseif (method_exists($event, 'getUserObject')) {
                    $u = $event->getUserObject();
                    if (is_object($u) && method_exists($u, 'getUserID')) {
                        $userId = (int) $u->getUserID();
                    }
                } elseif (method_exists($event, 'getUserID')) {
                    $userId = (int) $event->getUserID();
                }
            } elseif (is_array($event) && isset($event['uID'])) {
                $userId = (int) $event['uID'];
            }

            if ($userId <= 0) {
                return;
            }

            try {
                $provisioner = new LocalPdsProvisioner($app);
                $provisioner->ensureLocalAccountForUserId($userId);
            } catch (\Throwable $e) {
                Log::addWarning('xavi_social: failed to auto-provision PDS account for userId=' . $userId . ': ' . $e->getMessage());
            }
        };

        Events::addListener('on_user_add', $listener);
        Events::addListener('on_user_register', $listener);

        // Minimal JSON endpoints used by the vendored multigrid modules.
        // These are intentionally small shims so the UI doesn't spam 404/JSON parse errors.
        Route::register('/social/api/getUserStatus', static function () use ($app): JsonResponse {
            $u = new User();
            $ui = $u->getUserInfoObject();

            $isLoggedIn = $u->isRegistered();
            $isAdmin = false;
            if (is_object($ui) && method_exists($ui, 'isSuperUser')) {
                $isAdmin = (bool) $ui->isSuperUser();
            }

            return new JsonResponse([
                'success' => true,
                'isLoggedIn' => $isLoggedIn,
                'isAdmin' => $isAdmin,
            ]);
        });

        Route::register('/social/api/saveUserState', static function (Request $request) use ($app): JsonResponse {
            $u = new User();
            $session = $app->make('session');
            $key = $u->isRegistered() ? 'u' . (string) $u->getUserID() : 'anon';
            $sessionKey = 'xavi_social.user_state.' . $key;

            $raw = $request->request->get('state');
            if (!is_string($raw) || $raw === '') {
                $raw = $request->getContent();
            }

            $decoded = null;
            if (is_string($raw) && $raw !== '') {
                $tmp = json_decode($raw, true);
                if (json_last_error() === JSON_ERROR_NONE) {
                    $decoded = $tmp;
                }
            }

            $session->set($sessionKey, $decoded);

            return new JsonResponse([
                'success' => true,
            ]);
        });

        Route::register('/social/api/getUserState', static function () use ($app): JsonResponse {
            $u = new User();
            $session = $app->make('session');
            $key = $u->isRegistered() ? 'u' . (string) $u->getUserID() : 'anon';
            $sessionKey = 'xavi_social.user_state.' . $key;

            return new JsonResponse([
                'success' => true,
                'state' => $session->get($sessionKey),
            ]);
        });

        Route::register('/social/api/getCachedPlaylist', static function (): JsonResponse {
            return new JsonResponse([
                'success' => true,
                'count' => 0,
                'videos' => [],
            ]);
        });

        Route::register('/social/api/refreshCachedPlaylistFromYouTube', static function (): JsonResponse {
            return new JsonResponse([
                'success' => true,
                'refreshed' => 0,
            ]);
        });

        Route::register('/social/api/syncCachedPlaylist', static function (): JsonResponse {
            return new JsonResponse([
                'success' => true,
                'inserted' => 0,
                'updated' => 0,
            ]);
        });

        Route::register('/social/api/getUserPlaylists', static function (): JsonResponse {
            return new JsonResponse([
                'success' => true,
                'playlists' => [],
            ]);
        });

        Route::register('/social/api/getSongsForPlaylist', static function (): JsonResponse {
            return new JsonResponse([
                'success' => true,
                'songs' => [],
            ]);
        });

        Route::register('/social/api/createPlaylist', static function (): JsonResponse {
            return new JsonResponse([
                'success' => false,
                'message' => 'Playlists are not enabled on this host.',
            ]);
        });

        Route::register('/social/api/addSongToPlaylist', static function (): JsonResponse {
            return new JsonResponse([
                'success' => false,
                'message' => 'Playlists are not enabled on this host.',
            ]);
        });
    }

    private function installOrUpdateSinglePages(Package|PackageEntity $pkg): void
    {
        $this->removeLegacySinglePageTree('/xavi_social');

        $paths = [
            '/social',
            '/social/callback',
            '/social/client_metadata',
            '/social/api/session',
            '/social/api/jwt',
            '/social/api/me',
            '/social/api/me/ensure_account',
            '/social/api/accounts',
            '/social/api/accounts/upsert',
            '/social/api/accounts/delete',
            '/social/api/cache/upsert',
            '/social/api/feed',
            '/social/api/search',
            '/social/api/post',
            '/social/api/thread',
            '/social/api/profile',
            '/social/api/notifications',
            '/social/api/debug',
            '/social/auth/login',
            '/social/auth/logout',
        ];


        foreach ($paths as $path) {
            $page = SinglePage::add($path, $pkg);
            if ($page) {
                $page->setAttribute('exclude_nav', true);
            }
        }
    }

    private function removeLegacySinglePageTree(string $path): void
    {
        try {
            $page = Page::getByPath($path);
            if (!is_object($page) || $page->isError()) {
                return;
            }

            if (method_exists($page, 'getPackageHandle')) {
                $pkgHandle = (string) $page->getPackageHandle();
                if ($pkgHandle !== '' && $pkgHandle !== (string) $this->pkgHandle) {
                    return;
                }
            }

            $page->delete();
        } catch (\Throwable $e) {
            // Don't block installs/upgrades on cleanup failures.
        }
    }
}
