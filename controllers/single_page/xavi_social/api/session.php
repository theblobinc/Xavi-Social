<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api;

use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Support\Facade\Url;
use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;

class Session extends PageController
{
    public function view(): void
    {
        $user = $this->app->make(User::class);

        $popup = $this->isPopupRequest();
        $loginUrl = $popup ? (string) Url::to('/social/auth/login') . '?popup=1' : (string) Url::to('/social/auth/login');
        $logoutUrl = $popup ? (string) Url::to('/social/auth/logout') . '?popup=1' : (string) Url::to('/social/auth/logout');

        $payload = [
            'loggedIn' => $user->isRegistered(),
            'userId' => $user->isRegistered() ? (int) $user->getUserID() : null,
            'userName' => $user->isRegistered() ? (string) $user->getUserName() : null,
            'loginUrl' => $loginUrl,
            'logoutUrl' => $logoutUrl,
        ];

        $response = new JsonResponse($payload);
        $response->setEncodingOptions(JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('Content-Type', 'application/json; charset=utf-8');

        $response->send();
        exit;
    }

    private function isPopupRequest(): bool
    {
        $value = $this->request->query->get('popup');
        if ($value === null) {
            return false;
        }

        $normalized = strtolower((string) $value);

        return $normalized === '1' || $normalized === 'true' || $normalized === 'yes' || $normalized === 'on';
    }
}
