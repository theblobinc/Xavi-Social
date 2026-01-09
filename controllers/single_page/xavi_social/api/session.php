<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Api;

use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Support\Facade\Url;
use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;

final class Session extends PageController
{
    public function view(): void
    {
        $user = $this->app->make(User::class);

        $payload = [
            'loggedIn' => $user->isRegistered(),
            'userId' => $user->isRegistered() ? (int) $user->getUserID() : null,
            'userName' => $user->isRegistered() ? (string) $user->getUserName() : null,
            'loginUrl' => (string) Url::to('/xavi_social/auth/login'),
            'logoutUrl' => (string) Url::to('/xavi_social/auth/logout'),
        ];

        $response = new JsonResponse($payload);
        $response->setEncodingOptions(JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('Content-Type', 'application/json; charset=utf-8');

        $response->send();
        exit;
    }
}
