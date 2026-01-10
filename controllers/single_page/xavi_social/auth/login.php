<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Auth;

use Concrete\Core\Http\ResponseFactoryInterface;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\User\PostLoginLocation;
use Symfony\Component\HttpFoundation\Response;

final class Login extends PageController
{
    public function view(): void
    {
        $this->app->make(PostLoginLocation::class)->setSessionPostLoginUrl('/social');

        $response = $this->app->make(ResponseFactoryInterface::class)->redirect('/login', Response::HTTP_FOUND);
        $response->headers->set('Cache-Control', 'no-store');
        $response->send();
        exit;
    }
}
