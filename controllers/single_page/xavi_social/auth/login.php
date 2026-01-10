<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial\Auth;

use Concrete\Core\Http\ResponseFactoryInterface;
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\User\PostLoginLocation;
use Symfony\Component\HttpFoundation\Response;

class Login extends PageController
{
    public function view(): void
    {
        $popup = $this->isPopupRequest();
        $postLoginUrl = $popup ? '/social?popup=1' : '/social';
        $this->app->make(PostLoginLocation::class)->setSessionPostLoginUrl($postLoginUrl);

        $loginUrl = $popup ? '/login?popup=1' : '/login';
        $response = $this->app->make(ResponseFactoryInterface::class)->redirect($loginUrl, Response::HTTP_FOUND);
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
