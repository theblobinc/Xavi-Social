<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial;

use Concrete\Core\Entity\Package as PackageEntity;
use Concrete\Core\Page\Single as SinglePage;
use Concrete\Core\Page\Page;
use Concrete\Core\Package\Package;
use Concrete\Core\Support\Facade\Events;
use Concrete\Core\Support\Facade\Log;
use Concrete\Package\XaviSocial\Atproto\LocalPdsProvisioner;

final class Controller extends Package
{
    protected $pkgHandle = 'xavi_social';
    protected $appVersionRequired = '9.0.0';
    protected $pkgVersion = '0.1.5';

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
            '/social/api/feed',
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
