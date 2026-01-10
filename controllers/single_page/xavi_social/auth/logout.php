<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Auth;

use Concrete\Core\Http\ResponseFactoryInterface;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\Response;

class Logout extends PageController
{
    public function view(): void
    {
        $user = $this->app->make(User::class);
        if ($user->isRegistered()) {
            $user->logout(false);
        }

        $redirect = $this->isPopupRequest() ? '/social?popup=1' : '/social';
        $response = $this->app->make(ResponseFactoryInterface::class)->redirect($redirect, Response::HTTP_FOUND);
        $response->headers->set('Cache-Control', 'no-store');
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
