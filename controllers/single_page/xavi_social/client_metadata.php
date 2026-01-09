<?php

declare(strict_types=1);

namespace Concrete\Package\XaviSocial\Controller\SinglePage\XaviSocial;

use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Http\Request;
use Concrete\Core\Support\Facade\Config;
use Symfony\Component\HttpFoundation\JsonResponse;

final class ClientMetadata extends PageController
{
    public function view(): void
    {
        $canonicalUrl = (string) Config::get('site.sites.default.seo.canonical_url');
        if ($canonicalUrl !== '') {
            $origin = rtrim($canonicalUrl, '/');
        } else {
            $origin = Request::getInstance()->getSchemeAndHttpHost();
        }

        $metadata = [
            'client_id' => $origin . '/xavi_social/client_metadata',
                'client_name' => 'Princegeorge Social',
            'client_uri' => $origin . '/xavi_social',
            'redirect_uris' => [$origin . '/xavi_social/callback'],
            'scope' => 'atproto',
            'grant_types' => ['authorization_code', 'refresh_token'],
            'response_types' => ['code'],
            'token_endpoint_auth_method' => 'none',
            'application_type' => 'web',
            'dpop_bound_access_tokens' => true,
        ];

        $response = new JsonResponse($metadata);
        $response->setEncodingOptions(JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('Content-Type', 'application/json; charset=utf-8');

        $response->send();
        exit;
    }
}
