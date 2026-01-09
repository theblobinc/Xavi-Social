<?php

declare(strict_types=1);

use Concrete\Core\Support\Facade\Url;

defined('C5_EXECUTE') or die('Access Denied.');

$resolver = getenv('XAVI_SOCIAL_ATPROTO_XRPC_HOST');
$resolver = $resolver === false ? '' : rtrim(trim((string) $resolver), '/');
if ($resolver === '') {
	$resolver = rtrim((string) Url::to('/xavi_social/api'), '/');
}

?>
<div id="xavi-social-root" data-page="callback" data-handle-resolver="<?= h($resolver) ?>"></div>

<link rel="stylesheet" href="<?= h(Url::to('/packages/xavi_social/dist/app.css')) ?>" />
<script type="module" src="<?= h(Url::to('/packages/xavi_social/dist/app.js')) ?>"></script>
