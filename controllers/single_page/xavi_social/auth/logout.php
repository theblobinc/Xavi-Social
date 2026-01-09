<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Auth;

use Concrete\Core\Http\ResponseFactoryInterface;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\Response;

final class Logout extends PageController
{
    public function view(): void
    {
        $user = $this->app->make(User::class);
        if ($user->isRegistered()) {
            $user->logout(false);
        }

        $response = $this->app->make(ResponseFactoryInterface::class)->redirect('/xavi_social', Response::HTTP_FOUND);
        $response->headers->set('Cache-Control', 'no-store');
        $response->send();
        exit;
    }
}
